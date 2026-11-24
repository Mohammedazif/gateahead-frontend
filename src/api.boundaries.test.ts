import assert from "node:assert/strict";
import test from "node:test";
import { fetchCrossingDetails, fetchGates, fetchPredict, fetchReports, fetchScene, RequestError, submitReport, trainPauseUntil, type Gate } from "./api";

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

test("crossing access honors identity and expires dated evidence in the cache", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const signal = new AbortController().signal;
  const day = 86400000;
  const start = Date.parse("2026-11-20T20:00:00Z"); // 21 November in India.
  const bypass = { kind: "flyover", name: "Bridge", lat: 12.001, lon: 75, verified_on: "2026-11-21" };
  try {
    storage.clear();
    Date.now = () => start;
    const details = { crossing: gate, crossing_access: {
      source: "verified", cars: "allowed", two_wheelers: "allowed", pedestrians: "restricted",
      bypasses: [bypass, bypass, { ...bypass, lon: 75.001, verified_on: "2026-11-22" }],
    } };
    globalThis.fetch = async () => Response.json(details);
    const undated = await fetchCrossingDetails(gate, signal);
    assert.equal(undated.crossing_access?.source, "unavailable");
    assert.equal(undated.crossing_access?.cars, "unknown");
    assert.equal(undated.crossing_access?.bypasses.length, 1);
    globalThis.fetch = async () => Response.json({ ...details,
      crossing_access: { ...details.crossing_access, verified_on: "2026-11-21" } });
    assert.equal((await fetchCrossingDetails(gate, signal)).crossing_access?.source, "verified");
    Date.now = () => start + 366 * day;
    globalThis.fetch = async () => Response.json({ ...details, crossing: { ...gate, id: "osm:2" } });
    const fallback = await fetchCrossingDetails(gate, signal);
    assert.equal(fallback.offline, true);
    assert.equal(fallback.crossing?.id, gate.id);
    assert.equal(fallback.crossing_access?.source, "unavailable");
    assert.deepEqual(fallback.crossing_access?.bypasses, []);
    globalThis.fetch = async () => Response.json(scene);
    await fetchScene(12, 75, gate.id);
    globalThis.fetch = async () => Response.json({ detail: { code: "crossing_not_found" } }, { status: 404 });
    assert.deepEqual(await fetchCrossingDetails(gate, signal), { error: "crossing_not_found" });
    globalThis.fetch = async () => Response.json({ detail: "Not Found" }, { status: 404 });
    await assert.rejects(fetchCrossingDetails(gate, signal), RequestError);
    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(fetchScene(12, 75, gate.id), RequestError);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("concurrent train checks keep the greater service pause", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const now = 2_000_000_000_000;
  try {
    storage.clear();
    Date.now = () => now;
    const replies: Array<(response: Response) => void> = [];
    globalThis.fetch = async () => new Promise((resolve) => { replies.push(resolve); });
    const first = fetchScene(12, 75, gate.id);
    const second = fetchPredict(12, 75);
    const longer = assert.rejects(first, (err: RequestError) => err.retryAt === now + 600_000);
    const shorter = assert.rejects(second, (err: RequestError) => err.retryAt === now + 600_000);
    replies[0](new Response("{}", { status: 429, headers: { "Retry-After": "600" } }));
    await longer;
    replies[1](new Response("{}", { status: 429, headers: { "Retry-After": "60" } }));
    await shorter;
    assert.equal(trainPauseUntil(), now + 600_000);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; storage.clear(); }
});

test("invalid topology metadata cannot replace saved crossing locations", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    const grouped = { ...gate, group_id: "road:1", group_name: "School Road", group_size: 2, road: "School Road" };
    globalThis.fetch = async () => new Response(JSON.stringify({ gates: [grouped] }));
    const saved = await fetchGates(12, 75);
    for (const change of [{ group_id: {} }, { group_name: [] }, { road: {} }, { group_size: 0 }, { group_size: 1.5 }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ gates: [{ ...grouped, ...change }] }));
      const failed = await fetchGates(12, 75);
      assert.equal(failed.offline, true);
      assert.equal(failed.cached_at, saved.cached_at);
      assert.equal(failed.gates[0].group_id, grouped.group_id);
    }
  } finally { globalThis.fetch = original; }
});

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

test("invalid journey identity and operating notices cannot enter saved predictions", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [
      { ...prediction, approaching: [{ ...approach, run_id: {} }] },
      { ...prediction, service_updates: "unavailable" },
      { ...prediction, service_updates: [{ number: "16512", start_date: 123, status: "cancelled" }] },
      { ...prediction, service_updates: [{ number: "16512", status: "unknown_state" }] },
    ]) {
      storage.clear();
      globalThis.fetch = async () => new Response(JSON.stringify(body));
      await assert.rejects(fetchPredict(12, 75), RequestError);
    }
  } finally { globalThis.fetch = original; }
});
