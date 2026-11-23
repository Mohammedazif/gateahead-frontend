import assert from "node:assert/strict";
import test from "node:test";
import type { Predict, Scene } from "./api";
import { currentPrediction, currentScene, sceneFreshUntil } from "./timing";

const at = Date.parse("2026-11-16T14:16:00+05:30");
const prediction = {
  cached_at: at, generated_at: new Date(at).toISOString(), crossings: 2, stations: [], checked: 1, running: 1, sightings: [],
  approaching: [{ train: "16606", ids: ["a", "b"], eta: -1, closes_in: -6, status: "closed" }],
  gate_predictions: [{ id: "a", train: "16606", eta: -1, closes_in: -6, status: "closed" }, { id: "b", train: "16606", eta: 4, closes_in: -1, status: "closed" }],
} as Predict;
const scene = { available: true, cached_at: at, rail: [], trains: [{ number: "16606", name: "Ernad", snapshot_at: at / 1000, eta_min: 4, closes_in_min: -1, status: "closed", age_min: 0, along_km: 0 }] } as Scene;

test("nearby, train list, and details count down from the same check", () => {
  const now = at + 90000;
  const result = currentPrediction(prediction, now)!;
  const detail = currentScene(scene, now)!;
  assert.deepEqual(result.gate_predictions?.map((row) => row.id), ["b"]);
  assert.equal(result.approaching[0].eta, 2.5);
  assert.deepEqual(result.approaching[0].ids, ["b"]);
  assert.equal(result.gate_predictions![0].eta, detail.trains[0].eta_min);
  assert.equal(result.gate_predictions![0].closes_in, detail.trains[0].closes_in_min);
  assert.equal(prediction.approaching[0].eta, -1); // immutable source snapshot
});

test("offline snapshots retain original timing and expired live scenes show uncertainty", () => {
  assert.equal(currentPrediction({ ...prediction, offline: true }, at + 60000)?.approaching[0].eta, -1);
  assert.equal(currentPrediction(prediction, at + 180000)?.approaching[0].eta, -1);
  assert.equal(currentScene({ ...scene, offline: true }, at + 60000)?.trains[0].eta_min, 4);
  const expired = currentScene(scene, at + 180000)!;
  assert.equal(expired.trains.length, 0);
  assert.equal(expired.awaiting_update?.[0].reason, "estimate_elapsed");
});

test("counting down a timetable estimate cannot create a passed report", () => {
  const result = currentScene({ ...scene, trains: [{ ...scene.trains[0], eta_min: -1, basis: "timetable", observed: false }] }, at + 90000)!;
  assert.equal(result.trains.length, 0);
  assert.deepEqual(result.passed, []);
  assert.equal(result.awaiting_update?.[0].reason, "estimate_elapsed");
});

test("uncertain approaching estimates are not promoted to a closed gate", () => {
  const result = currentScene({ ...scene, trains: [{ ...scene.trains[0], status: "approaching", closes_in_min: 0.5 }] }, at + 60000)!;
  assert.equal(result.trains[0].status, "approaching");
});

test("a fresh closed-gate train keeps moving through its ETA beyond the area check interval", () => {
  const moving = { ...scene, trains: [{ ...scene.trains[0], motion: { direction: 1, speed_kmh: 60, valid_for_sec: 420 } }] };
  assert.equal(sceneFreshUntil(moving), at + 420000);
  assert.equal(currentScene(moving, at + 180000)!.trains[0].eta_min, 1);
  assert.equal(currentScene(moving, at + 240000)!.trains[0].eta_min, 0);
  assert.equal(currentScene(moving, at + 270000)!.trains[0].eta_min, -0.5);
  assert.equal(currentScene({ ...moving, offline: true }, at + 240000)!.trains[0].eta_min, 4);
});

test("a second fresh train remains current after the first scene report expires", () => {
  const mixed = { ...scene, trains: [
    { ...scene.trains[0], number: "16512" },
    { ...scene.trains[0], number: "16511", motion: { direction: -1, speed_kmh: 60, valid_for_sec: 420 } },
  ] };
  assert.equal(sceneFreshUntil(mixed), at + 420000);
  const result = currentScene(mixed, at + 180000)!;
  assert.deepEqual(result.trains.map((train) => train.number), ["16511"]);
  assert.equal(result.trains[0].eta_min, 1);
  assert.equal(result.awaiting_update?.[0].number, "16512");
});

test("a stopped train does not cross or pass a gate on the client timer", () => {
  const stopped = { ...scene, trains: [{ ...scene.trains[0], movement: "stopped" as const, eta_min: -1,
    current: "Pazhayangadi", age_min: 0 }] };
  const result = currentScene(stopped, at + 90000)!;
  assert.equal(result.trains[0].eta_min, -1);
  assert.equal(result.passed!.length, 0);
  assert.equal(result.awaiting_update!.length, 0);
});

test("an expired stopped report remains unresolved beside a fresh second train", () => {
  const mixed = { ...scene, crossing: { id: "elimala", name: "Elimala", lat: 12.06, lon: 75.23 }, trains: [
    { ...scene.trains[0], number: "16650", current: "Pazhayangadi", movement: "stopped" as const, age_min: 7.5 },
    { ...scene.trains[0], number: "16603", motion: { direction: -1, speed_kmh: 60, valid_for_sec: 420 } },
  ] };
  const result = currentScene(mixed, at + 60000)!;
  assert.deepEqual(result.trains.map((train) => train.number), ["16603"]);
  assert.equal(result.awaiting_update![0].number, "16650");
  assert.equal(result.awaiting_update![0].current, "Pazhayangadi");
  assert.equal(result.passed!.length, 0);
  assert.equal(mixed.trains.length, 2);
});

test("nearby and train lists hold stopped estimates and mark expired reports unresolved", () => {
  const stopped = { ...prediction, approaching: [{ ...prediction.approaching[0], eta: 3, at_station: true,
    current: "Pazhayangadi", age_min: 7 }], gate_predictions: [{ ...prediction.gate_predictions![0], eta: 3 }] };
  const held = currentPrediction(stopped, at + 30000)!;
  assert.equal(held.gate_predictions![0].eta, 3);
  assert.equal(held.approaching[0].eta, 3);
  const expired = currentPrediction(stopped, at + 60000)!;
  assert.equal(expired.gate_predictions!.length, 0);
  assert.equal(expired.approaching.length, 0);
  assert.equal(expired.awaiting_update![0].current, "Pazhayangadi");
});

test("moving estimates stay unresolved after their source age boundary without inventing passage", () => {
  const reported = { ...scene, crossing: { id: "school", name: "School Road", lat: 12, lon: 75 }, trains: [
    { ...scene.trains[0], eta_min: 0, observed: true, age_min: 7.5, movement: "moving" as const,
      motion: { direction: 1, speed_kmh: 60, valid_for_sec: 30 } },
  ] };
  assert.equal(currentScene(reported, at + 29000)!.trains.length, 1);
  for (const offset of [30000, 120000, 180000]) {
    const expired = currentScene(reported, at + offset)!;
    assert.equal(expired.trains.length, 0);
    assert.deepEqual(expired.passed, []);
    assert.equal(expired.awaiting_update?.[0].reason, "stale_report");
    assert.deepEqual(expired.awaiting_update?.[0].ids, ["school"]);
  }
});
