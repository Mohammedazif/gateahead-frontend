import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Gate, Predict } from "./api";
import { gateHoverLines, groupCheckLabel, groupCrossingTimings, groupGates } from "./gateGroups";
import { PredictBody, TrainSheet } from "./sheet/TrainSheet";

const point = (id: string, extra: Partial<Gate> = {}): Gate => ({ id, name: "Near Trikaripur", lat: 12, lon: 75,
  km: 0.4, source: "osm", ...extra });
const a = point("100", { group_id: "road-7:100", group_name: "Market Road", group_size: 2 });
const b = point("101", { ...a, id: "101", lon: 75.00005, km: 0.5 });

test("only topology metadata groups track points; names and very close coordinates do not", () => {
  const separateRoad = point("102", { group_id: "road-8:102", group_name: a.group_name });
  const legacy = point("103");
  const groups = groupGates([a, b, separateRoad, legacy, point("104")]);
  assert.deepEqual(groups.map((group) => group.members.map((gate) => gate.id)), [["100", "101"], ["102"], ["103"], ["104"]]);
  assert.equal(groups[0].primary, a);
  assert.equal(groups[0].members[1], b);
  assert.equal(a.name, "Near Trikaripur");
});

test("group summaries keep uncertain or unknown track checks visible beside known estimates", () => {
  const known = { ...a, eta: 12, closesIn: 7, status: "approaching" };
  assert.match(groupCheckLabel(groupGates([known, { ...b, status: "uncertain" }])[0]), /Position update needed.*Est\. closes in 7 min/);
  assert.match(groupCheckLabel(groupGates([known, b])[0]), /First track.*closes in 7 min.*1 track timing unknown/);
  assert.equal(groupGates([known, b])[0].members[1].eta, undefined);
});

test("hover identifies the exact mapped point and keeps untrusted names literal", () => {
  const malicious = { ...a, name: '<img src=x onerror="alert(1)">', status: "uncertain" };
  const lines = gateHoverLines(malicious, [malicious, b]);
  assert.deepEqual(lines, ["Market Road", malicious.name, "0.4 km away", "Track crossing 1 of 2", "Position update needed"]);
  assert.match(gateHoverLines(b, [a, b]).join("\n"), /0.5 km away\nTrack crossing 2 of 2/);
});

test("a physical train timing group preserves per-track ETAs, status and original IDs", () => {
  const timings = [
    { key: a.id, label: a.name, eta: 1, closesIn: -4, status: "closed" },
    { key: b.id, label: b.name, eta: 13, closesIn: 8, status: "approaching" },
    { key: "different-road", label: a.name, eta: 2, status: "closing_soon" },
  ];
  const grouped = groupCrossingTimings(timings, [a, b]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].members, [timings[0], timings[1]]);
  assert.equal(grouped[0].label, "Market Road");
  assert.equal(grouped[0].first, timings[0]);
  assert.equal(grouped[0].members[1].eta, 13);
});

const prediction = (): Predict => ({ crossings: 2, checked: 2, running: 2, stations: [], sightings: [],
  approaching: ["2026-11-15", "2026-11-16"].map((date, i) => ({ train: "16512", name: "Daily Express", run_id: `16512:${date}`, start_date: date,
    cluster: a.name, count: 2, ids: [a.id, b.id], eta: i ? 20 : 1, closes_in: i ? 15 : -4,
    status: i ? "approaching" : "closed", at_station: false, current: "On the line", from_you_km: .4, lat: 12, lon: 75 })),
  gate_predictions: ["2026-11-15", "2026-11-16"].flatMap((date, i) => [a, b].map((gate, track) => ({ id: gate.id,
    train: "16512", name: "Daily Express", run_id: `16512:${date}`, start_date: date,
    eta: (i ? 20 : 1) + track * 12, closes_in: (i ? 15 : -4) + track * 12, status: i || track ? "approaching" : "closed" }))) });

for (const offline of [false, true]) test(`${offline ? "saved" : "fresh"} cards group track checks within each daily journey`, () => {
  const html = renderToStaticMarkup(createElement(PredictBody, { predict: { ...prediction(), offline }, gates: [a, b] }));
  assert.equal((html.match(/class="train"/g) ?? []).length, 2);
  assert.equal((html.match(/class="timing-group"/g) ?? []).length, 2);
  assert.equal((html.match(/2 track checks/g) ?? []).length, 2);
  assert.match(html, /Started 2026-11-15/);
  assert.match(html, /Started 2026-11-16/);
  assert.match(html, /Track crossing 1 of 2/);
  assert.match(html, /Track crossing 2 of 2/);
  assert.match(html, /closed · train in 1 min/);
  assert.match(html, /closes in 8 min/);
  assert.match(html, /closes in 27 min/);
});

test("a waiting check on the second track warns in its collapsed journey group only", () => {
  const predict = prediction();
  predict.gate_predictions = predict.gate_predictions!.filter((row) => !(row.id === b.id && row.start_date === "2026-11-15"));
  predict.awaiting_update = [{ number: "16512", name: "Daily Express", run_id: "16512:2026-11-15", start_date: "2026-11-15",
    current: "Trikaripur", age_min: 12, reason: "stopped_report", ids: [b.id] }];
  const html = renderToStaticMarkup(createElement(PredictBody, { predict, gates: [a, b] }));
  const cards = html.split('<article class="train">').slice(1);
  assert.match(cards[0], /class="timing-summary".*Position update needed/);
  assert.match(cards[0], /First track estimate · closed · train in 1 min/);
  assert.match(cards[0], /Track crossing 2 of 2<\/span><span>Position update needed/);
  assert.doesNotMatch(cards[1], /Position update needed/);
});

test("nearby physical rows expose independent member buttons and warn about uncertain checks", () => {
  const props = { gates: [{ ...a, eta: 12, closesIn: 7 }, { ...b, status: "uncertain" }], place: { lat: 12, lon: 75 },
    selected: null, favorites: [], refresh: { mode: "manual" }, scene: null, loading: false, theme: "light" } as unknown as Parameters<typeof TrainSheet>[0];
  const html = renderToStaticMarkup(createElement(TrainSheet, props));
  assert.equal((html.match(/class="hot crossing-row"/g) ?? []).length, 1);
  assert.match(html, /1 crossing on this map/);
  assert.match(html, /Position update needed · Est\. closes in 7 min/);
  assert.match(html, /Track crossing 1 of 2/);
  assert.match(html, /Track crossing 2 of 2/);
  assert.match(html, /Est. closes in 7 min/);
});
