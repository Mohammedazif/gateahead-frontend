import assert from "node:assert/strict";
import test from "node:test";
import { cachedResponse, fetchGates, fetchPredict, fetchScene, RequestError } from "./api";
import { currentPrediction, currentScene } from "./timing";

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

test("a malformed successful response keeps the last usable offline prediction", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ crossings: 2, approaching: [], sightings: [] }));
    const first = await fetchPredict(12, 75);
    for (const body of ["<html>service restarting</html>", "null", "[]", "42", "{}", '{"approaching":null,"sightings":[]}']) {
      globalThis.fetch = async () => new Response(body);
      const saved = await fetchPredict(12, 75);
      assert.equal(saved.offline, true);
      assert.equal(saved.crossings, 2);
      assert.equal(saved.cached_at, first.cached_at);
    }
  } finally { globalThis.fetch = original; }
});

test("malformed successful responses without a saved result produce a usable error", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    for (const body of ["not json", "null", "[]", "42", "{}", '{"approaching":"unavailable","sightings":[]}']) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(fetchPredict(12, 75), RequestError);
      assert.equal(cachedResponse("/api/predict?lat=12&lon=75"), null);
    }
  } finally { globalThis.fetch = original; }
});

test("wrong response object shapes cannot reach crossing and scene consumers", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    for (const body of [{}, { gates: "unavailable" }, { gates: [null] }, { gates: [{ id: "a", km: "far" }] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body));
      await assert.rejects(fetchGates(12, 75), RequestError);
    }
    for (const body of [{}, { available: true, rail: [], trains: "unavailable" }, { available: true, rail: [], trains: [null] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body));
      await assert.rejects(fetchScene(12, 75, "osm:1"), RequestError);
    }
    assert.equal(cachedResponse("/api/gates?lat=12&lon=75"), null);
    assert.equal(cachedResponse("/api/scene?lat=12&lon=75&crossing_id=osm%3A1"), null);
  } finally { globalThis.fetch = original; }
});

test("an incomplete saved object is ignored before restoring a prediction", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    storage.set("gateahead:responses", JSON.stringify({ "/api/predict?lat=12&lon=75": { at: Date.now(), data: {} } }));
    assert.equal(cachedResponse("/api/predict?lat=12&lon=75"), null);
    globalThis.fetch = async () => new Response(JSON.stringify({ approaching: [], sightings: [] }));
    const result = await fetchPredict(12, 75);
    assert.doesNotThrow(() => currentPrediction(result, Date.now()));
  } finally { globalThis.fetch = original; }
});

test("bare service errors remain usable by scene and prediction consumers", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "map_busy" }));
    const scene = await fetchScene(12, 75, "osm:1");
    assert.equal(scene.error, "map_busy");
    assert.doesNotThrow(() => currentScene(scene, Date.now()));
    const prediction = await fetchPredict(12, 75);
    assert.equal(prediction.error, "map_busy");
    assert.doesNotThrow(() => currentPrediction(prediction, Date.now()));
  } finally { globalThis.fetch = original; }
});

test("aborting before headers complete cannot pause checks or return saved data", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [429, 503]) {
      storage.clear();
      globalThis.fetch = async () => new Response(JSON.stringify({ approaching: [], sightings: [] }));
      await fetchPredict(12, 75);
      const controller = new AbortController();
      let finish!: (response: Response) => void;
      globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
      const request = fetchPredict(12, 75, controller.signal);
      controller.abort();
      finish(new Response("{}", { status, headers: { "Retry-After": "45" } }));
      await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === "AbortError");
      assert.equal(storage.has("gateahead:paused-until"), false);
    }
  } finally { globalThis.fetch = original; }
});

test("invalid saved response containers cannot prevent a fresh check", async () => {
  const original = globalThis.fetch;
  try {
    for (const invalid of [null, [], 42, "old format", { bad: null }]) {
      storage.clear();
      storage.set("gateahead:responses", JSON.stringify(invalid));
      globalThis.fetch = async () => new Response(JSON.stringify({ crossings: 3, approaching: [], sightings: [] }));
      const result = await fetchPredict(12, 75);
      assert.equal(result.crossings, 3);
      assert.equal(cachedResponse("/api/predict?lat=12&lon=75")?.data.crossings, 3);
    }
  } finally { globalThis.fetch = original; }
});

test("an aborted scene request cannot return a cached scene", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    globalThis.fetch = async () => new Response(JSON.stringify({ available: true, rail: [], trains: [] }));
    await fetchScene(12, 75, "osm:1");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchScene(12, 75, "osm:1", controller.signal), (error: unknown) => error instanceof Error && error.name === "AbortError");
  } finally { globalThis.fetch = original; }
});

test("aborting while a response is parsed cannot update the saved result", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    const controller = new AbortController();
    let finish!: (body: unknown) => void;
    let parsing!: () => void;
    const started = new Promise<void>((resolve) => { parsing = resolve; });
    globalThis.fetch = async () => ({ ok: true, status: 200, json: () => {
      parsing();
      return new Promise((resolve) => { finish = resolve; });
    } }) as Response;
    const request = fetchPredict(12, 75, controller.signal);
    await started;
    controller.abort();
    finish({ crossings: 1, approaching: [], sightings: [] });
    await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === "AbortError");
    assert.equal(cachedResponse("/api/predict?lat=12&lon=75"), null);
  } finally { globalThis.fetch = original; }
});

test("HTTP-date retry headers preserve the provider's retry time", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    const retryAt = Math.floor(Date.now() / 1000) * 1000 + 120000;
    globalThis.fetch = async () => new Response("{}", { status: 429, headers: { "Retry-After": new Date(retryAt).toUTCString() } });
    await assert.rejects(fetchPredict(12, 75), (error: unknown) => error instanceof RequestError && error.retryAt === retryAt);
  } finally { globalThis.fetch = original; }
});

test("invalid retry delays use the default pause instead of allowing immediate retries", async () => {
  const original = globalThis.fetch;
  try {
    for (const retry of ["-3", "Infinity", "invalid"]) {
      storage.clear();
      globalThis.fetch = async () => new Response("{}", { status: 429, headers: { "Retry-After": retry } });
      const before = Date.now();
      await assert.rejects(fetchPredict(12, 75), (error: unknown) => error instanceof RequestError && error.retryAt >= before + 600000 && error.retryAt <= Date.now() + 600000);
    }
  } finally { globalThis.fetch = original; }
});

test("a slower earlier scene response cannot replace a newer completed check in the cache", async () => {
  const original = globalThis.fetch;
  try {
    storage.clear();
    const complete: ((response: Response) => void)[] = [];
    globalThis.fetch = () => new Promise((resolve) => complete.push(resolve));
    const oldRequest = fetchScene(12, 75, "osm:1");
    const newRequest = fetchScene(12, 75, "osm:1");
    const row = { name: "Express", status: "approaching", eta_min: 12, age_min: 0, along_km: 0 };
    complete[1](new Response(JSON.stringify({ available: true, rail: [], trains: [{ ...row, number: "16603" }] })));
    await newRequest;
    complete[0](new Response(JSON.stringify({ available: true, rail: [], trains: [{ ...row, number: "16650" }] })));
    await oldRequest;
    const reopened = await fetchScene(12, 75, "osm:1");
    assert.equal(reopened.trains[0].number, "16603");
  } finally { globalThis.fetch = original; }
});
