import assert from "node:assert/strict";
import test from "node:test";
import { fetchPredict, fetchReports, fetchScene, RequestError, submitReport, type Gate } from "./api";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });
const gate: Gate = { id: "osm:1", name: "School Road", lat: 12, lon: 75, km: 0.3, source: "osm" };
const approach = { train: "16603", name: "Maveli Express", cluster: gate.name, ids: [gate.id], eta: 6,
  closes_in: 1, status: "closing_soon", at_station: false, current: "On the line", from_you_km: 0.3, lat: 12, lon: 75, count: 1 };
const prediction = { approaching: [approach], sightings: [], gate_predictions: [{ id: gate.id, train: "16603", name: "Maveli Express", eta: 6, status: "closing_soon" }] };
const scene = { available: true, crossing: gate, rail: [[11.9, 75], [12.1, 75]],
  trains: [{ number: "16603", name: "Maveli Express", eta_min: 6, status: "closing_soon", age_min: 0, along_km: 1 }] };

test("bad nested prediction fields preserve the saved check and original timestamp", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify(prediction));
    const saved = await fetchPredict(12, 75);
    for (const change of [{ ids: {} }, { name: {} }, { eta: null }, { current: {} }, { status: [] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ...prediction, approaching: [{ ...approach, ...change }] }));
      const failed = await fetchPredict(12, 75);
      assert.equal(failed.offline, true, JSON.stringify(change));
      assert.equal(failed.cached_at, saved.cached_at);
      assert.equal(failed.approaching[0].name, "Maveli Express");
    }
  } finally { globalThis.fetch = original; }
});

test("malformed nested scenes are rejected before map and timing consumers", async () => {
  const original = globalThis.fetch;
  try {
    for (const change of [{ track: { rail: "unavailable" } }, { eta_min: null }, { name: {} },
      { motion: { direction: 2, speed_kmh: 60, valid_for_sec: 90 } }, { snapshot_at: "yesterday" }, { snapshot_at: Number.MAX_VALUE }]) {
      storage.clear();
      globalThis.fetch = async () => new Response(JSON.stringify({ ...scene, trains: [{ ...scene.trains[0], ...change }] }));
      await assert.rejects(fetchScene(12, 75, gate.id), RequestError, JSON.stringify(change));
    }
  } finally { globalThis.fetch = original; }
});

test("an invalid prediction timestamp cannot freeze stopped report aging", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify(prediction));
    const saved = await fetchPredict(12, 75);
    for (const generated_at of ["not-a-date", {}, 123, ""]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ...prediction, generated_at }));
      const body = await fetchPredict(12, 75);
      assert.equal(body.offline, true);
      assert.equal(body.cached_at, saved.cached_at);
    }
  } finally { globalThis.fetch = original; }
});

test("a future-dated saved scene cannot prevent a current server check", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    storage.set("gateahead:responses", JSON.stringify({ "/api/scene?lat=12&lon=75&crossing_id=osm%3A1": {
      at: Date.now() + 3600000, data: scene,
    } }));
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...scene, trains: [] })); };
    const body = await fetchScene(12, 75, gate.id);
    assert.equal(calls, 1);
    assert.deepEqual(body.trains, []);
  } finally { globalThis.fetch = original; }
});

test("malformed community replies cannot replace report state or claim success", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    // This identifier represents an existing installation; no new UUID is needed.
    storage.set("gateahead:installation", JSON.stringify("test-installation-12345"));
    for (const body of [{}, { reports: null }, { reports: [{}] }, { reports: [{ state: {}, at: 1, expires_at: 2 }] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body));
      await assert.rejects(fetchReports(gate.id), RequestError);
      await assert.rejects(submitReport(gate, "closed"), RequestError);
    }
  } finally { globalThis.fetch = original; }
});
