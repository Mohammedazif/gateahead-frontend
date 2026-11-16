import assert from "node:assert/strict";
import test from "node:test";
import { readFavorites, validPlace } from "./features";

test("malformed legacy saved gates cannot reach crossing details or React labels", () => {
  const gate = { id: "valid", name: "Home crossing", lat: 12, lon: 75, km: .4, source: "osm" };
  const place = { lat: 12, lon: 75, label: "Kannur" };
  const valid = { gate, place, label: "Home" };
  const rows = [valid,
    { ...valid, gate: { ...gate, id: "missing-km", km: undefined } },
    { ...valid, gate: { ...gate, id: "object-name", name: { old: "name" } } },
    { ...valid, gate: { ...gate, id: "bad-distance", km: -1 } },
    { ...valid, gate: { ...gate, id: "missing-source", source: undefined } },
    { ...valid, gate: { ...gate, id: "object-road", road: { name: "Old road" } } },
    { ...valid, gate: { ...gate, id: "object-group", group_id: {} } },
    { ...valid, place: { ...place, label: { old: "city" } } },
  ];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: (key: string) => key === "gateahead:favorites" ? JSON.stringify(rows) : null } });
  try { assert.deepEqual(readFavorites(), [valid]); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("a saved location with a malformed label cannot crash the location control", () => {
  assert.equal(validPlace({ lat: 12, lon: 75, label: { old: "Kannur" } }), false);
  assert.equal(validPlace({ lat: 12, lon: 75, label: "Kannur" }), true);
  assert.equal(validPlace({ lat: 12, lon: 75 }), true);
});
