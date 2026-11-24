import assert from "node:assert/strict";
import test from "node:test";
import { checkCommuteGates, mergeCommuteResult, readCommutes, type CommuteResult } from "./commute";
import type { SavedGate } from "./features";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });

test("damaged or duplicated commute rows cannot change the order of valid saved crossings", () => {
  storage.set("gateahead:commutes", JSON.stringify([
    null, { id: "test", gateIds: ["first"], label: " " },
    { id: "test", gateIds: ["second", 3, "second", "first"], label: " Evening " },
    { id: "test", gateIds: ["first"], label: "Duplicate" },
  ]));
  assert.deepEqual(readCommutes(), [{ id: "test", label: "Evening", gateIds: ["second", "first"] }]);
});

test("a commute rate limit pauses queued scenes and keeps checks already in flight", async () => {
  storage.clear();
  const items: SavedGate[] = ["first", "second", "third", "fourth"].map((label) => ({ label,
    gate: { id: label, name: label, lat: 12, lon: 75, km: 0, source: "osm" }, place: { lat: 12, lon: 75 },
  }));
  const original = globalThis.fetch;
  const requested: string[] = [];
  const results = new Map<string, CommuteResult>();
  let pause = 0;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), "https://gateahead.example");
      const id = url.searchParams.get("crossing_id")!;
      requested.push(id);
      return id === "first" ? new Response("{}", { status: 429, headers: { "Retry-After": "30" } })
        : Response.json({ available: true, crossing: items.find((item) => item.gate.id === id)!.gate, rail: [], trains: [] });
    };
    await checkCommuteGates(items, new AbortController().signal, (id, result) => results.set(id, result), (retry) => { pause = retry; });
    assert.deepEqual(requested, ["first", "second"]);
    assert.ok(pause > Date.now());
    assert.equal(results.get("second")?.scene?.crossing?.id, "second");
    assert.match(results.get("third")?.error ?? "", /paused/);
    assert.match(results.get("fourth")?.error ?? "", /paused/);
  } finally { globalThis.fetch = original; }
});

test("a failed refresh keeps the prior timing as historical without reviving a removed crossing", () => {
  const prior: CommuteResult = { scene: { available: true, cached_at: 500, rail: [], trains: [] } };
  assert.deepEqual(mergeCommuteResult(prior, { scene: null, error: "Checks paused" }), {
    scene: { ...prior.scene, offline: true }, error: "Checks paused",
  });
  assert.deepEqual(mergeCommuteResult(prior, { scene: null, error: "Crossing removed", invalidated: true }), {
    scene: null, error: "Crossing removed", invalidated: true,
  });
});
