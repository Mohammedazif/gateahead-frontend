import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Gate, Predict, Scene, ServiceUpdate } from "./api";
import { runKey } from "./runIdentity";
import { currentPrediction, currentScene } from "./timing";
import { withGateChecks } from "./features";
import { frameForRun, sceneRun } from "./map/playback";
import { OperatingUpdates } from "./sheet/OperatingUpdates";

const at = Date.parse("2026-11-16T10:00:00+05:30");
const gate: Gate = { id: "gate", name: "Gate", lat: 12.01, lon: 75, km: 1, source: "osm" };
const old = { run_id: "16512:2026-11-15", start_date: "2026-11-15" };
const latest = { run_id: "16512:2026-11-16", start_date: "2026-11-16" };
const scene: Scene = { available: true, cached_at: at, crossing: gate, rail: [[12, 75], [12.02, 75]], trains: [
  { ...old, number: "16512", name: "Regional", current: "South", eta_min: 3, status: "closed", age_min: 7,
    movement: "stopped", along_km: 0.2, position_on_segment: true, snapshot_at: at / 1000 },
  { ...latest, number: "16512", name: "Regional", eta_min: 4, status: "closing_soon", age_min: 0,
    movement: "moving", along_km: 0.3, position_on_segment: true, snapshot_at: at / 1000,
    motion: { direction: 1, speed_kmh: 10, valid_for_sec: 420 } },
] };
const prediction: Predict = { cached_at: at, crossings: 1, stations: [], running: 2, checked: 2, sightings: [],
  approaching: scene.trains.map((row) => ({ ...row, train: row.number, current: row.current || "South", cluster: "Gate",
    count: 1, eta: row.eta_min, from_you_km: 1, lat: 12.01, lon: 75, ids: ["gate"], at_station: row.movement === "stopped" })),
  gate_predictions: scene.trains.map((row) => ({ ...row, train: row.number, id: "gate", eta: row.eta_min })),
};

test("two running journeys of the same train draw separate markers", () => {
  assert.equal(runKey(scene.trains[0]), old.run_id);
  const frame = frameForRun(sceneRun(scene)!, at);
  assert.deepEqual(frame.trains?.map(runKey), [old.run_id, latest.run_id]);
  assert.notEqual(frame.trains![0].lat, frame.trains![1].lat);
});

test("a stale stopped journey cannot hide another journey of the same train", () => {
  const current = currentScene(scene, at + 60000)!;
  assert.deepEqual(current.trains.map(runKey), [latest.run_id]);
  assert.deepEqual(current.awaiting_update?.map(runKey), [old.run_id]);
  const nearby = currentPrediction(prediction, at + 60000)!;
  assert.deepEqual(nearby.approaching.map(runKey), [latest.run_id]);
  const combined = withGateChecks(nearby, [current], [gate])!;
  assert.deepEqual(combined.approaching.map(runKey), [latest.run_id]);
  assert.deepEqual(combined.awaiting_update?.map(runKey), [old.run_id]);
});

test("a newer cancellation replaces stale crossing estimates only for that journey", () => {
  const update: ServiceUpdate = { ...old, number: "16512", status: "cancelled", notice: "Cancelled" };
  const checked: Scene = { ...scene, cached_at: at + 1000, trains: [scene.trains[1]], service_updates: [update] };
  const combined = withGateChecks(prediction, [checked], [gate])!;
  assert.deepEqual(combined.gate_predictions?.map(runKey), [latest.run_id]);
  assert.deepEqual(combined.approaching.map(runKey), [latest.run_id]);
  assert.deepEqual(combined.service_updates, [update]);
  const resumed = withGateChecks(combined, [{ ...scene, cached_at: at + 2000 }], [gate])!;
  assert.deepEqual(resumed.service_updates, []);
});

test("operating notices name the journey and withhold diversion timing", () => {
  const html = renderToStaticMarkup(createElement(OperatingUpdates, { updates: [
    { ...old, number: "16512", status: "diverted", notice: "Diverted" },
    { ...latest, number: "16512", status: "cancelled", notice: "Cancelled" },
  ] }));
  assert.match(html, /Started 2026-11-15/);
  assert.match(html, /Started 2026-11-16/);
  assert.match(html, /Diverted/);
  assert.match(html, /Cancelled/);
  assert.match(html, /until this journey/);
  assert.doesNotMatch(html, /closes in/);
});
