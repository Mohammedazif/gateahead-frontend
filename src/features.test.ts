import assert from "node:assert/strict";
import test from "node:test";
import { defaultRefresh, inRefreshWindow, markGates, readLink, validPlace, withGateChecks } from "./features.ts";
import type { Predict, Scene } from "./api";

test("shared links reject absent and invalid coordinates", () => {
  assert.equal(readLink("https://gateahead.vercel.app/"), null);
  assert.equal(readLink("https://gateahead.vercel.app/?lat=NaN&lon=75"), null);
  assert.equal(readLink("https://gateahead.vercel.app/?lat=91&lon=75"), null);
  assert.equal(validPlace({ lat: Infinity, lon: 12 }), false);
  assert.deepEqual(readLink("https://gateahead.vercel.app/?lat=12.1&lon=75.2&gate=osm%3A12&name=Home"), { lat: 12.1, lon: 75.2, gateId: "osm:12", label: "Home" });
});

test("weekday overnight commute belongs to the day it starts", () => {
  const settings = { ...defaultRefresh, enabled: true, commute: true, start: "22:00", end: "02:00" };
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 20, 23)), true); // Friday
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 21, 1)), true); // Friday's window
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 21, 23)), false);
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 23, 1)), false); // Sunday's window
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 20, 12)), false);
});

test("normal commute windows use an exclusive end and reject equal hours", () => {
  const settings = { ...defaultRefresh, commute: true };
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 16, 8)), true);
  assert.equal(inRefreshWindow(settings, new Date(2026, 10, 16, 10)), false);
  assert.equal(inRefreshWindow({ ...settings, end: "08:00" }, new Date(2026, 10, 16, 8)), false);
});


test("gate markers use exact crossing results and retain individual names", () => {
  const gates = ["passed", "next", "later"].map((id) => ({ id, name: `Road ${id}`, lat: 12, lon: 75, km: 0, source: "osm" }));
  const predict = { crossings: 3, stations: [], checked: 1, running: 1, sightings: [], approaching: [{ ids: ["passed", "next", "later"], eta: 0, status: "closed", cluster: "One cluster" }],
    gate_predictions: [{ id: "next", train: "16323", name: "Express", eta: 3, status: "closed" }, { id: "later", train: "16323", name: "Express", eta: 5, status: "closed" }] };
  const marked = markGates(gates, predict as Parameters<typeof markGates>[1]);
  assert.equal(marked[0].eta, undefined);
  assert.equal(marked[1].eta, 3);
  assert.equal(marked[2].eta, 5);
  assert.equal(marked[1].name, "Road next");
});

test("an older grouped estimate keeps affected gates visible without claiming exact timing", () => {
  const gate = { id: "a", name: "School Road", lat: 12, lon: 75, km: 0, source: "osm" };
  const predict = { approaching: [{ ids: ["a", "b"], eta: 0, status: "closed" }] };
  const marked = markGates([gate], predict as Parameters<typeof markGates>[1])[0];
  assert.equal(marked.status, "approaching");
  assert.equal(marked.groupEstimate, true);
  assert.equal(marked.eta, undefined);
});

test("a newer gate check replaces the old Nearby estimate when returning to the list", () => {
  const gate = { id: "a", name: "School Road", lat: 12, lon: 75, km: 0, source: "osm" };
  const predict = { cached_at: 10, approaching: [], gate_predictions: [{ id: "a", eta: 0, status: "closed" }] } as unknown as Predict;
  const scene = { cached_at: 20, available: true, crossing: { id: "a" }, trains: [] } as unknown as Scene;
  assert.equal(markGates([gate], predict, scene)[0].eta, undefined);
  assert.equal(markGates([gate], predict, { ...scene, cached_at: 5 })[0].eta, 0);
});

test("checked gates retain their latest train when switching between details and lists", () => {
  const gate = { id: "a", name: "School Road", lat: 12, lon: 75, km: 0.4, source: "osm" };
  const predict = { cached_at: 10, approaching: [{ train: "16323", ids: ["a"], eta: 0, status: "closed" }],
    gate_predictions: [{ id: "a", train: "16323", eta: 0, status: "closed" }] } as Predict;
  const checked = { cached_at: 20, available: true, crossing: { id: "a" }, trains: [{ number: "16606", name: "Ernad", eta_min: 4, closes_in_min: -1, status: "closed", age_min: 1 }] } as Scene;
  const latest = withGateChecks(predict, [checked], [gate])!;
  assert.equal(latest.approaching.length, 1);
  assert.equal(latest.approaching[0].train, "16606");
  assert.equal(latest.approaching[0].eta, 4);
  assert.equal(markGates([gate], latest)[0].eta, 4);
  assert.equal(predict.approaching[0].train, "16323");
});

test("an unresolved train remains visible beside a separate closure estimate", () => {
  const gate = { id: "elimala", name: "Near Elimala", lat: 12.06, lon: 75.23, km: 2.6, source: "osm" };
  const predict = { approaching: [], gate_predictions: [{ id: "elimala", train: "16603", eta: 2, closes_in: -3, status: "closed" }],
    awaiting_update: [{ number: "16650", ids: ["elimala"] }] } as unknown as Predict;
  const marked = markGates([gate], predict)[0];
  assert.equal(marked.status, "closed");
  assert.equal(marked.eta, 2);
  assert.equal(marked.positionUncertain, true);
});

test("a fresh gate check resolves only that gate's waiting report", () => {
  const predict = { cached_at: 10, approaching: [], gate_predictions: [],
    awaiting_update: [{ number: "16650", name: "Parasuram", current: "Pazhayangadi", age_min: 14,
      reason: "stopped_report", ids: ["elimala", "further-north"] }] } as Predict;
  const scene = { cached_at: 20, available: true, crossing: { id: "elimala" }, trains: [], awaiting_update: [] } as unknown as Scene;
  const updated = withGateChecks(predict, [scene])!;
  assert.deepEqual(updated.awaiting_update![0].ids, ["further-north"]);
  assert.deepEqual(predict.awaiting_update![0].ids, ["elimala", "further-north"]);
});

test("an incomplete empty scene preserves earlier estimates until it accounts for that run", () => {
  const gate = { id: "a", name: "School Road", lat: 12, lon: 75, km: .4, source: "osm" };
  const row = { id: gate.id, train: "16323", name: "Express", eta: 2, closes_in: -3, status: "closed" };
  const predict: Predict = { cached_at: 10, crossings: 1, stations: [], checked: 1, running: 1,
    approaching: [], sightings: [], gate_predictions: [row] };
  const empty: Scene = { cached_at: 20, available: true, crossing: gate, rail: [], trains: [],
    coverage: { status: "partial", live_checked: 0, live_candidates: 0, pending_live: 0, missing_or_stale_routes: 0 } };
  assert.deepEqual(withGateChecks(predict, [empty], [gate])?.gate_predictions, [row]);
  assert.equal(markGates([gate], predict, empty)[0].eta, 2);
  const complete = { ...empty, coverage: { ...empty.coverage!, status: "complete" as const } };
  assert.deepEqual(withGateChecks(predict, [complete], [gate])?.gate_predictions, []);
  const passed = withGateChecks(predict, [{ ...empty, passed: [{ number: "16323", name: "Express", ago_min: 3 }] }], [gate])!;
  assert.deepEqual(passed.gate_predictions, []);
  assert.equal(passed.passed?.[0].train, "16323");
  assert.deepEqual(passed.passed?.[0].ids, ["a"]);
  assert.equal(passed.passed?.[0].from_you_km, .4);
});

test("newer dated journey information wins across crossing checks regardless of iteration order", () => {
  const a = { id: "a", name: "School Road", lat: 12, lon: 75, km: .4, source: "osm" };
  const b = { ...a, id: "b" };
  const run = { number: "16323", name: "Express", run_id: "16323:2026-11-23" };
  const active = { ...run, eta_min: 1, status: "closed", age_min: 1, along_km: 0 };
  const cancellation = { ...run, status: "cancelled" as const, notice: "" };
  const base: Predict = { cached_at: 10, crossings: 2, stations: [], checked: 1, running: 0,
    approaching: [], sightings: [], gate_predictions: [] };
  const runningScene: Scene = { crossing: a, available: true, cached_at: 20, rail: [], trains: [active] };
  const cancelledScene: Scene = { crossing: b, available: true, cached_at: 30, rail: [], trains: [], service_updates: [cancellation] };
  for (const scenes of [[cancelledScene, runningScene], [runningScene, cancelledScene]]) {
    const result = withGateChecks(base, scenes, [a, b])!;
    assert.deepEqual(result.gate_predictions, []);
    assert.deepEqual(result.service_updates, [cancellation]);
  }
  const staleKnownActive = { ...runningScene, cached_at: 50, trains: [], active_at_check: [run.run_id] };
  const restored = withGateChecks(base, [staleKnownActive, cancelledScene], [a, b])!;
  assert.deepEqual(restored.service_updates, []);
  const timetableOnly = { ...runningScene, cached_at: 60, trains: [{ ...active, observed: false }] };
  assert.deepEqual(withGateChecks(base, [timetableOnly, cancelledScene], [a, b])?.service_updates, [cancellation]);
});
