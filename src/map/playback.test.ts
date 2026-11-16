import assert from "node:assert/strict";
import test from "node:test";

import { BARRIER_OFFSET_M, ROAD_GAP_M, frameAt, frameForRun, metresBetween, toPlane } from "./playback.ts";

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
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "closed" }, 4, false);
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

test("a report without movement metadata remains at its reported position", () => {
  const rail: [number, number][] = [
    [12, 75],
    [12.02, 75],
  ];
  const start = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed", onSegment: true }, 0, false);
  const done = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed", onSegment: true }, 14, false);
  assert.ok(start.train);
  assert.ok(done.train);
  assert.ok(start.train.lat < 12.01);
  assert.ok(done.train.lat < 12.01);
  assert.ok(Math.abs(done.train.bearing) < 8);
  assert.ok(metresBetween(start.train, done.train) < 0.01);
});

test("a held report stays where it was reported", () => {
  const rail: [number, number][] = [
    [12, 75],
    [12.02, 75],
  ];
  const held = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed", onSegment: true }, 14, true);
  const fresh = frameAt(rail, { lat: 12.01, lon: 75 }, { alongKm: 0.3, status: "closed", onSegment: true }, 0, false);
  assert.ok(held.train);
  assert.ok(fresh.train);
  assert.ok(metresBetween(held.train, fresh.train) < 1);
  assert.equal(held.lowered, 1);
});

test("a distant train is not clamped onto the local track endpoint", () => {
  const rail: [number, number][] = [[11.995, 75], [12.005, 75]];
  const frame = frameAt(rail, crossing, { alongKm: 0, status: "approaching", onSegment: false, ageMin: 1 }, 14, false);
  assert.equal(frame.train, null);
});

test("old reports hide the train marker and do not animate the barrier", () => {
  const rail: [number, number][] = [[11.995, 75], [12.005, 75]];
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "closed", onSegment: true, ageMin: 8 }, 14, false);
  assert.equal(frame.train, null);
  assert.equal(frame.barriers.length, 0);
});

test("closing soon does not draw the barrier as already down", () => {
  const rail: [number, number][] = [[11.995, 75], [12.005, 75]];
  const frame = frameAt(rail, crossing, { alongKm: 0.2, status: "closing_soon", ageMin: 1 }, 14, false);
  assert.equal(frame.barriers.length, 0);
});

const localRail: [number, number][] = [[11.985, 75], [12.015, 75]];
const moving = { alongKm: 0, status: "closed", etaMin: 1, closesInMin: -4, onSegment: false, ageMin: 1,
  motion: { direction: 1, speed_kmh: 60, valid_for_sec: 120 } };

test("a moving train crosses automatically at its ETA, in real time", () => {
  const first = frameAt(localRail, crossing, moving, 0);
  const atGate = frameAt(localRail, crossing, moving, 60);
  const after = frameAt(localRail, crossing, moving, 75);
  assert.ok(first.train && first.train.lat < crossing.lat);
  assert.ok(atGate.train && metresBetween(atGate.train, crossing) < 1);
  assert.ok(after.train && after.train.lat > crossing.lat);
  assert.ok(after.train && Math.abs(after.train.bearing) < 1); // nose does not flip after passing
});

test("the animation handles reverse travel on the same track", () => {
  const train = { ...moving, motion: { ...moving.motion, direction: -1 } };
  const first = frameAt(localRail, crossing, train, 0);
  const after = frameAt(localRail, crossing, train, 75);
  assert.ok(first.train && first.train.lat > crossing.lat);
  assert.ok(after.train && after.train.lat < crossing.lat && Math.abs(after.train.bearing) > 179);
});

test("a train 23 minutes away is never replayed at the crossing after 14 seconds", () => {
  const train = { ...moving, etaMin: 23, closesInMin: 18, status: "approaching" };
  assert.equal(frameAt(localRail, crossing, train, 0).train, null);
  assert.equal(frameAt(localRail, crossing, train, 14).train, null);
  assert.equal(frameAt(localRail, crossing, train, 14).barriers.length, 0);
});

test("closed before arrival shows the approaching train and animates until it passes", () => {
  const rail: [number, number][] = [[11.96, 75], [12.04, 75]];
  const at = Date.parse("2026-11-16T14:16:00+05:30");
  const train = { ...moving, etaMin: 4, snapshotAt: at, motion: { ...moving.motion, valid_for_sec: 420 } };
  const run = { id: "g", rail, crossing, train };
  const first = frameForRun(run, at);
  const enRoute = frameForRun(run, at + 180000);
  const arrived = frameForRun(run, at + 240000);
  const passed = frameForRun(run, at + 270000);
  assert.ok(first.train && first.train.lat < crossing.lat);
  assert.ok(enRoute.train && enRoute.train.lat > first.train.lat && enRoute.train.lat < crossing.lat);
  assert.ok(arrived.train && metresBetween(arrived.train, crossing) < 1);
  assert.ok(passed.train && passed.train.lat > crossing.lat);
});

test("reopening a cached scene continues from snapshot time rather than replaying", () => {
  const snapshotAt = Date.parse("2026-11-16T14:16:00+05:30");
  const run = { id: "g", rail: localRail, crossing, train: { ...moving, snapshotAt } };
  const firstOpen = frameForRun(run, snapshotAt);
  // A new run object on reopening carries the original cached timestamp.
  const reopened = frameForRun({ ...run }, snapshotAt + 75000);
  assert.ok(firstOpen.train && firstOpen.train.lat < crossing.lat);
  assert.ok(reopened.train && reopened.train.lat > crossing.lat);
  assert.equal(frameForRun({ ...run }, snapshotAt + 121000).train, null);
});

test("expired motion and out-of-bounds positions disappear without endpoint clamping", () => {
  assert.equal(frameAt(localRail, crossing, moving, 121).train, null);
  assert.equal(frameAt(localRail, crossing, { ...moving, ageMin: 7.5 }, 31).train, null);
  assert.equal(frameAt(localRail, crossing, { alongKm: 100, status: "closed", onSegment: true }, 0).train, null);
});

test("barriers follow closure time and the estimated clearance window", () => {
  const train = { ...moving, status: "closing_soon", closesInMin: 0.5, etaMin: 5.5 };
  assert.equal(frameAt(localRail, crossing, train, 0).lowered, 0);
  assert.equal(frameAt(localRail, crossing, train, 31).lowered, 1);
  assert.equal(frameAt(localRail, crossing, { ...moving, etaMin: -1.5 }, 31).lowered, 0);
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
