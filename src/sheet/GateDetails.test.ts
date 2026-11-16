import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GateDetails } from "./GateDetails";
import type { Gate, Predict, Scene } from "../api";
import { currentPrediction, currentScene } from "../timing";
import { markGates, withGateChecks } from "../features";
import { frameForRun, sceneRun } from "../map/playback";

test("an unresolved stopped train stays visible ahead of other train estimates", () => {
  const scene = { available: true, rail: [], trains: [{ number: "16603", name: "Maveli Express", eta_min: 12,
    closes_in_min: 7, status: "approaching", age_min: 4, along_km: 0 }],
    awaiting_update: [{ number: "16650", name: "Parasuram Express", current: "Pazhayangadi", age_min: 14,
      reason: "stopped_report", ids: ["elimala"] }] } as Scene;
  const html = renderToStaticMarkup(createElement(GateDetails, {
    gate: { id: "elimala", name: "Near Elimala", km: 2.6, lat: 12.06, lon: 75.23, source: "osm" },
    scene, loading: false, message: null, historical: false, focusedTrain: null, visibleTrains: new Set<string>(),
    onFocusTrain() {}, saved: false, onSave() {}, onBack() {},
  }));
  assert.match(html, /Position update needed/);
  assert.match(html, /Last reported stopped at Pazhayangadi/);
  assert.match(html, /Other reported train/);
  assert.ok(html.indexOf("16650") < html.indexOf("16603"));
  assert.doesNotMatch(html, /Next approaching train/);
});

test("minute-by-minute stopped-feed simulation keeps 16650 unresolved beside independently moving 16603", () => {
  const at = Date.parse("2026-11-16T14:16:00+05:30");
  const gate: Gate = { id: "elimala", name: "Near Elimala", km: 2.6, lat: 12, lon: 75, source: "osm" };
  const snapshot: Scene = { available: true, cached_at: at, crossing: gate, rail: [[11.93, 75], [12.07, 75]], trains: [
    { number: "16650", name: "Parasuram Express", current: "Pazhayangadi", movement: "stopped", eta_min: 6,
      closes_in_min: 1, status: "closing_soon", age_min: 7, along_km: 5, position_on_segment: true, snapshot_at: at / 1000 },
    { number: "16603", name: "Maveli Express", movement: "moving", eta_min: 6, closes_in_min: 1,
      status: "closing_soon", age_min: 0, along_km: 0, snapshot_at: at / 1000,
      motion: { direction: 1, speed_kmh: 60, valid_for_sec: 420 } },
  ] };
  const prediction: Predict = { cached_at: at, generated_at: new Date(at).toISOString(), crossings: 1,
    stations: [], checked: 2, running: 2, sightings: [], approaching: snapshot.trains.map((train) => ({
      train: train.number, name: train.name, current: train.current || "On the line", cluster: gate.name,
      ids: [gate.id], count: 1, eta: train.eta_min, closes_in: train.closes_in_min, status: train.status,
      at_station: train.movement === "stopped", age_min: train.age_min, from_you_km: gate.km, lat: gate.lat, lon: gate.lon,
    })), gate_predictions: snapshot.trains.map((train) => ({ id: gate.id, train: train.number, name: train.name,
      eta: train.eta_min, closes_in: train.closes_in_min, status: train.status, age_min: train.age_min,
      at_station: train.movement === "stopped" })) };
  const run = sceneRun(snapshot)!;
  let lastMovingLat = -Infinity;
  for (let second = 0; second <= 360; second += 15) {
    const now = at + second * 1000;
    const display = currentScene(snapshot, now)!;
    const frame = frameForRun(run, now);
    const combined = withGateChecks(currentPrediction(prediction, now), [display], [gate])!;
    const moving = frame.trains!.find((train) => train.number === "16603")!;
    assert.ok(moving, `16603 remains visible at ${second}s`);
    assert.ok(moving.lat > lastMovingLat, `16603 keeps its direction at ${second}s`);
    lastMovingLat = moving.lat;
    assert.equal(display.passed?.some((train) => train.number === "16650"), false);
    const html = renderToStaticMarkup(createElement(GateDetails, {
      gate, scene: display, loading: false, message: null, historical: false, focusedTrain: null,
      visibleTrains: new Set(frame.trains!.map((train) => train.number)), onFocusTrain() {}, saved: false,
      onSave() {}, onBack() {},
    }));
    if (second < 60) {
      assert.equal(display.trains.find((train) => train.number === "16650")!.eta_min, 6);
      assert.equal(frame.lowered, 0);
      assert.doesNotMatch(html, /Position update needed/);
    } else {
      assert.match(html, /Position update needed/);
      assert.match(html, /Last reported stopped at Pazhayangadi/);
      assert.match(html, /Other reported train/);
      assert.ok(html.indexOf("16650") < html.indexOf("16603"));
      assert.equal(frame.trains!.some((train) => train.number === "16650"), false);
      assert.equal(markGates([gate], combined, display)[0].status, "uncertain");
      assert.equal(markGates([gate], combined, display)[0].eta, undefined);
      assert.deepEqual(combined.awaiting_update!.map((train) => train.number), ["16650"]);
    }
  }
});
