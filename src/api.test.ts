import assert from "node:assert/strict";
import test from "node:test";
import { fetchPredict, fetchScene, RequestError } from "./api";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });

test("offline predictions preserve the original fetch timestamp", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ crossings: 1, approaching: [], sightings: [] }));
    const fresh = await fetchPredict(12, 75);
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    const saved = await fetchPredict(12, 75);
    assert.equal(saved.offline, true);
    assert.equal(saved.cached_at, fresh.cached_at);
    assert.equal(saved.crossings, 1);
  } finally { globalThis.fetch = original; }
});

test("a failed map response cannot overwrite a successful prediction", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ crossings: 2, approaching: [], sightings: [] }));
    await fetchPredict(12, 75);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "map_busy", crossings: 0 }));
    const saved = await fetchPredict(12, 75);
    assert.equal(saved.offline, true);
    assert.equal(saved.crossings, 2);
  } finally { globalThis.fetch = original; }
});

test("opening the same scene within 90 seconds reuses its response", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ available: true, rail: [], trains: [] })); };
    await fetchScene(12, 75, "osm:1");
    await fetchScene(12, 75, "osm:1");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("rate limits retain the server retry delay", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response("{}", { status: 429, headers: { "Retry-After": "45" } });
    const before = Date.now();
    await assert.rejects(fetchPredict(12, 75), (error: unknown) => error instanceof RequestError && error.retryAt >= before + 45000 && error.retryAt <= Date.now() + 45000);
  } finally { globalThis.fetch = original; }
});


test("a newer nearby check invalidates an older scene inside the 90-second cache", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ available: true, rail: [], trains: [] })); };
    const first = await fetchScene(12, 75, "osm:1");
    await fetchScene(12, 75, "osm:1", undefined, first.cached_at! + 1);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
