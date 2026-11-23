import assert from "node:assert/strict";
import test from "node:test";

import { BARRIER_OFFSET_M, ROAD_GAP_M, frameAt, frameForRun, metresBetween, runFreshUntil, sceneRun, toPlane } from "./playback.ts";
import type { Scene } from "../api";

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

const multiAt = Date.parse("2026-11-16T16:56:00+05:30");
const multiScene: Scene = { available: true, crossing: { id: "g", name: "Gate", ...crossing }, rail: localRail, cached_at: multiAt,
  trains: [
    { number: "16512", name: "North", along_km: 0, age_min: 1, status: "closed", eta_min: 0.5, closes_in_min: -4.5, snapshot_at: multiAt / 1000, motion: { direction: 1, speed_kmh: 60, valid_for_sec: 120 } },
    { number: "16511", name: "South", along_km: 0, age_min: 1, status: "closed", eta_min: 0.5, closes_in_min: -4.5, snapshot_at: multiAt / 1000, motion: { direction: -1, speed_kmh: 60, valid_for_sec: 360 } },
  ] };

test("two identified trains animate simultaneously in opposite directions", () => {
  const run = sceneRun(multiScene)!;
  const first = frameForRun(run, multiAt).trains!;
  const later = frameForRun(run, multiAt + 15000).trains!;
  assert.deepEqual(first.map((train) => train.number), ["16512", "16511"]);
  assert.ok(later[0].lat > first[0].lat && later[1].lat < first[1].lat);
  assert.ok(Math.abs(later[0].bearing) < 1 && Math.abs(later[1].bearing) > 179);
});

test("one train expiring does not remove the second marker or reopen the barrier", () => {
  const source = { ...multiScene, trains: multiScene.trains.map((train) => ({ ...train, eta_min: 2.5 })) };
  const frame = frameForRun(sceneRun(source)!, multiAt + 121000);
  assert.deepEqual(frame.trains!.map((train) => train.number), ["16511"]);
  assert.equal(frame.lowered, 1);
});

test("a passed first train does not hide the second approaching service", () => {
  const source = { ...multiScene, trains: [{ ...multiScene.trains[0], eta_min: -1.8 }, multiScene.trains[1]] };
  const frame = frameForRun(sceneRun(source)!, multiAt + 20000);
  assert.deepEqual(frame.trains!.map((train) => train.number), ["16511"]);
  assert.equal(frame.lowered, 1);
});

test("each train retains its own snapshot time and estimated parallel track", () => {
  const trackRail: [number, number][] = localRail.map(([lat, lon]) => [lat, lon + 0.00015]);
  const source = { ...multiScene, trains: [multiScene.trains[0], { ...multiScene.trains[1], snapshot_at: multiAt / 1000 - 15,
    track: { estimated: true, rail: trackRail, along_km: 0, position_on_segment: false, motion: multiScene.trains[1].motion } }] };
  const frame = frameForRun(sceneRun(source)!, multiAt);
  assert.equal(frame.trains!.length, 2);
  assert.ok(frame.trains![0].lat < crossing.lat);
  assert.ok(frame.trains![1].lat > crossing.lat);
  assert.ok(Math.abs(frame.trains![1].lon - crossing.lon - 0.00015) < 0.00001);
  assert.equal(frame.paths!.length, 1);
});

test("offline scenes suppress all markers and duplicate train IDs are not cloned", () => {
  assert.equal(frameForRun(sceneRun({ ...multiScene, offline: true })!, multiAt).trains!.length, 0);
  const duplicate = { ...multiScene, trains: [...multiScene.trains, multiScene.trains[0]] };
  assert.equal(frameForRun(sceneRun(duplicate)!, multiAt).trains!.length, 2);
});

test("a stopped train keeps its reported position and cannot close the barrier by timer", () => {
  const source: Scene = { ...multiScene, trains: [{ ...multiScene.trains[0], movement: "stopped", motion: undefined,
    status: "closing_soon", eta_min: 6, closes_in_min: 1, along_km: 0.4, position_on_segment: true }] };
  const run = sceneRun(source)!;
  const first = frameForRun(run, multiAt);
  const later = frameForRun(run, multiAt + 90000);
  assert.ok(first.train && later.train);
  assert.ok(metresBetween(first.train, later.train) < 0.01);
  assert.equal(later.lowered, 0);
});

test("stopped reports remain visible through their freshness window and then disappear", () => {
  const source: Scene = { ...multiScene, trains: [{ ...multiScene.trains[0], movement: "stopped", motion: undefined,
    status: "closing_soon", eta_min: 6, closes_in_min: 1, along_km: 0.4, position_on_segment: true }] };
  const run = sceneRun(source)!;
  assert.equal(runFreshUntil(run, multiAt), multiAt + 7 * 60000);
  assert.equal(frameForRun(run, multiAt + 6 * 60000).trains!.length, 1);
  assert.equal(frameForRun(run, multiAt + 7 * 60000).trains!.length, 0);
  assert.equal(frameForRun(run, multiAt + 7 * 60000).lowered, 0);
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

test("expiry removes an estimated boom and makes the barrier explicitly unknown", () => {
  const at = Date.parse("2026-11-23T10:00:00Z");
  const run = sceneRun({ available: true, cached_at: at, crossing: { id: "school", name: "School Road", lat: 12, lon: 75 },
    rail: [[11.99, 75], [12.01, 75]], trains: [{ number: "16512", name: "Express", age_min: 7.5,
      along_km: .5, status: "closed", eta_min: 2, closes_in_min: -3, movement: "moving",
      motion: { direction: 1, speed_kmh: 15, valid_for_sec: 30 }, snapshot_at: at / 1000 }] })!;
  const fresh = frameForRun(run, at + 29000);
  assert.equal(fresh.lowered, 1);
  assert.equal(fresh.unconfirmed, false);
  const expired = frameForRun(run, at + 30000);
  assert.equal(expired.unconfirmed, true);
  assert.deepEqual(expired.barriers, []);
  assert.deepEqual(expired.posts, []);
  assert.equal(expired.train, null);
});
