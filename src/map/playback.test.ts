import assert from "node:assert/strict";
import test from "node:test";

import { BARRIER_OFFSET_M, ROAD_GAP_M, frameAt, metresBetween, PLAY_SECONDS, toPlane } from "./playback.ts";

const crossing = { lat: 12, lon: 75 };

test("a northbound gate blocks the road and leaves the track open", () => {
  const rail: [number, number][] = [
    [11.995, 75],
    [12.005, 75],
  ];
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "closed" }, 4, false);
  assert.equal(frame.barriers.length, 2);
  assert.equal(frame.road.length, 2);
  assert.ok(frame.acrossRoad > 0.95);
  assert.ok(frame.clearance > 20);

  const gate = toPlane(crossing, crossing);
  const track = { x: 0, y: 1 };
  const railA = { x: 0, y: -400 };
  const railB = { x: 0, y: 400 };
  for (const [a, b] of frame.barriers) {
    const pa = toPlane(a, crossing);
    const pb = toPlane(b, crossing);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const boom = { x: pb.x - pa.x, y: pb.y - pa.y };
    const boomLen = Math.hypot(boom.x, boom.y) || 1;
    const along = Math.abs((boom.x * track.x + boom.y * track.y) / boomLen);
    assert.ok(along > 0.95, `boom should run along the track, got ${along}`);
    const off = Math.hypot(mid.x - gate.x, mid.y - gate.y);
    assert.ok(Math.abs(off - BARRIER_OFFSET_M) < 1.5);
    assert.ok(!segmentsCross(pa, pb, railA, railB));
  }

  for (const [a, b] of frame.road) {
    const pa = toPlane(a, crossing);
    const pb = toPlane(b, crossing);
    assert.ok(!segmentsCross(pa, pb, railA, railB));
    const near = Math.min(Math.hypot(pa.x, pa.y), Math.hypot(pb.x, pb.y));
    assert.ok(Math.abs(near - ROAD_GAP_M) < 1.5);
  }
  assert.ok(
    frame.barriers.some(([a, b]) =>
      frame.road.some(([c, d]) => segmentsCross(toPlane(a, crossing), toPlane(b, crossing), toPlane(c, crossing), toPlane(d, crossing))),
    ),
  );
});

test("an eastbound gate sits north and south of the rail", () => {
  const rail: [number, number][] = [
    [12, 74.995],
    [12, 75.005],
  ];
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "closing_soon" }, 4, false);
  assert.equal(frame.barriers.length, 2);
  const lats = frame.barriers.map(([a]) => a.lat);
  assert.ok(lats.some((lat) => lat > crossing.lat + 0.0001));
  assert.ok(lats.some((lat) => lat < crossing.lat - 0.0001));
  for (const [a, b] of frame.barriers) {
    assert.ok(Math.abs(a.lat - b.lat) < 0.00005);
    assert.ok(Math.abs(a.lon - b.lon) > 0.00005);
    assert.ok(metresBetween({ lat: crossing.lat, lon: a.lon }, { lat: a.lat, lon: a.lon }) > 20);
  }
});

test("a raised gate draws posts and no boom across the road", () => {
  const rail: [number, number][] = [
    [11.995, 75],
    [12.005, 75],
  ];
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "approaching" }, 0.2, false);
  assert.equal(frame.barriers.length, 0);
  assert.equal(frame.posts.length, 2);
  assert.equal(frame.road.length, 2);
  assert.equal(frame.lowered, 0);
  for (const [a, b] of frame.road) {
    assert.ok(!segmentsCross(toPlane(a, crossing), toPlane(b, crossing), { x: 0, y: -400 }, { x: 0, y: 400 }));
  }
});

test("the train runs through the crossing instead of stopping at the gate", () => {
  const rail: [number, number][] = [
    [12, 75],
    [12.02, 75],
  ];
  const start = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed" }, 0, false);
  const done = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed" }, PLAY_SECONDS, false);
  assert.ok(start.train);
  assert.ok(done.train);
  assert.ok(start.train.lat < 12.01);
  assert.ok(done.train.lat > 12.01, `train stopped at ${done.train.lat}`);
  assert.ok(Math.abs(done.train.bearing) < 8);
  assert.ok(metresBetween(start.train, done.train) > 200);
});

test("a held report stays where it was reported", () => {
  const rail: [number, number][] = [
    [12, 75],
    [12.02, 75],
  ];
  const held = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed" }, PLAY_SECONDS, true);
  const fresh = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed" }, 0, false);
  assert.ok(held.train);
  assert.ok(fresh.train);
  assert.ok(metresBetween(held.train, fresh.train) < 1);
  assert.equal(held.lowered, 1);
});

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const adx = d.x - a.x;
  const ady = d.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;
  const cbx = b.x - c.x;
  const cby = b.y - c.y;
  const side = (px: number, py: number, qx: number, qy: number) => px * qy - py * qx;
  return side(abx, aby, acx, acy) * side(abx, aby, adx, ady) < 0 && side(cdx, cdy, cax, cay) * side(cdx, cdy, cbx, cby) < 0;
}
