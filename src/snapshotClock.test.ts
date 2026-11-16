import assert from "node:assert/strict";
import test from "node:test";
import type { Predict, Scene } from "./api";
import { currentPrediction, currentScene } from "./timing";
import { frameForRun, sceneRun } from "./map/playback";
import { snapshotTime } from "./snapshotClock";

const at = Date.parse("2026-11-16T08:00:00Z");
for (const offset of [-3600000, 3600000]) {
  test(`stopped reports age on the original receipt clock when server offset is ${offset}`, () => {
    const prediction: Predict = { cached_at: at, generated_at: new Date(at + offset).toISOString(),
      crossings: 1, checked: 1, running: 1, stations: [], sightings: [],
      approaching: [{ train: "16650", name: "Parasuram", current: "Pazhayangadi", cluster: "School Road", count: 1,
        ids: ["a"], eta: 6, status: "closing_soon", age_min: 7, at_station: true, from_you_km: .2, lat: 12, lon: 75 }] };
    const scene: Scene = { cached_at: at, available: true, crossing: { id: "a", name: "School Road", lat: 12, lon: 75 },
      rail: [[11.93, 75], [12.07, 75]], trains: [{ number: "16650", name: "Parasuram", eta_min: 6, status: "closing_soon",
        age_min: 7, along_km: 5, movement: "stopped", position_on_segment: true, snapshot_at: (at + offset) / 1000 }] };
    assert.equal(currentPrediction(prediction, at)!.approaching.length, 1);
    assert.equal(currentScene(scene, at)!.trains.length, 1);
    for (const now of [at + 70000, at + 90000]) {
      assert.equal(currentPrediction(prediction, now)!.awaiting_update![0].number, "16650");
      assert.equal(currentScene(scene, now)!.awaiting_update![0].number, "16650");
      assert.equal(frameForRun(sceneRun(scene)!, now).trains!.length, 0);
    }
  });
  test(`moving map estimates continue on the receipt clock when server offset is ${offset}`, () => {
    const scene: Scene = { cached_at: at, available: true, crossing: { id: "a", name: "School Road", lat: 12, lon: 75 },
      rail: [[11.93, 75], [12.07, 75]], trains: [{ number: "16603", name: "Maveli", eta_min: 6, closes_in_min: 1,
        status: "closing_soon", age_min: 0, along_km: 0, snapshot_at: (at + offset) / 1000,
        motion: { direction: 1, speed_kmh: 60, valid_for_sec: 480 } }] };
    const run = sceneRun(scene)!;
    const first = frameForRun(run, at).trains![0];
    const later = frameForRun(run, at + 45000).trains![0];
    assert.ok(later.lat > first.lat);
    assert.equal(currentScene(scene, at + 45000)!.trains[0].eta_min, 5.25);
  });
}
test("a plausible transit delay and missing source clock keep their original anchors", () => {
  assert.equal(snapshotTime(at - 15000, at), at - 15000);
  assert.equal(snapshotTime(undefined, at), at);
  assert.equal(snapshotTime(at, undefined), at);
  assert.equal(snapshotTime(Number.NaN, at), at);
});
