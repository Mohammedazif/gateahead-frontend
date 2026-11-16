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

test("offline and expired snapshots retain their original timing", () => {
  assert.equal(currentPrediction({ ...prediction, offline: true }, at + 60000)?.approaching[0].eta, -1);
  assert.equal(currentPrediction(prediction, at + 180000)?.approaching[0].eta, -1);
  assert.equal(currentScene({ ...scene, offline: true }, at + 60000)?.trains[0].eta_min, 4);
  assert.equal(currentScene(scene, at + 180000)?.trains[0].eta_min, 4);
});

test("an estimate becomes recently passed after its clearance window", () => {
  const result = currentScene({ ...scene, trains: [{ ...scene.trains[0], eta_min: -1 }] }, at + 90000)!;
  assert.equal(result.trains.length, 0);
  assert.equal(result.passed![0].number, "16606");
  assert.equal(result.passed![0].ago_min, 2.5);
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
});
