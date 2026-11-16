import type { Scene } from "../api";
import { snapshotTime } from "../snapshotClock";

export type LngLat = { lat: number; lon: number };
export type Plane = { x: number; y: number };

export type MapRun = {
  id: string;
  rail: [number, number][];
  crossing: LngLat;
  train: {
    alongKm: number; status: string; onSegment?: boolean; ageMin?: number;
    movement?: "moving" | "stopped";
    etaMin?: number; closesInMin?: number; snapshotAt?: number;
    motion?: { direction: number; speed_kmh: number; valid_for_sec: number };
  } | null;
  trains?: (NonNullable<MapRun["train"]> & { number: string; name: string; rail?: [number, number][] })[];
};

export type TrainFrame = { number: string; name: string; lat: number; lon: number; bearing: number };

export type RunFrame = {
  train: { lat: number; lon: number; bearing: number } | null;
  trains?: TrainFrame[];
  paths?: [number, number][][];
  road: [LngLat, LngLat][];
  barriers: [LngLat, LngLat][];
  posts: LngLat[];
  clearance: number;
  acrossRoad: number;
  lowered: number;
};

export function frameForRun(run: MapRun, now: number, hold = false): RunFrame {
  if (run.trains == null) return frameAt(run.rail, run.crossing, run.train, Math.max(0, (now - (run.train?.snapshotAt ?? now)) / 1000), hold);
  const visible: TrainFrame[] = [];
  const paths: [number, number][][] = [];
  const seen = new Set<string>();
  let lowered = false;
  for (const train of run.trains) {
    if (seen.has(train.number)) continue;
    seen.add(train.number);
    const elapsed = Math.max(0, (now - (train.snapshotAt ?? now)) / 1000);
    const frame = frameAt(train.rail ?? run.rail, run.crossing, train, elapsed, hold);
    lowered ||= frame.lowered > 0;
    if (frame.train) {
      visible.push({ ...frame.train, number: train.number, name: train.name });
      if (train.rail) paths.push(train.rail);
    }
  }
  const base = frameAt(run.rail, run.crossing, { alongKm: 0, status: lowered ? "closed" : "open", onSegment: false }, 0, hold);
  return { ...base, train: visible[0] ?? null, trains: visible, paths };
}

export function sceneRun(scene: Scene, historical = false): MapRun | null {
  if (!scene.available || !scene.crossing || scene.rail.length < 2) return null;
  return { id: scene.crossing.id, rail: scene.rail, crossing: scene.crossing, train: null,
    trains: historical || scene.offline ? [] : scene.trains.map((row) => ({ number: row.number, name: row.name,
      rail: row.track?.rail, alongKm: row.track?.along_km ?? row.along_km,
      onSegment: row.track?.position_on_segment ?? row.position_on_segment === true,
      movement: row.movement, motion: row.movement === "stopped" ? undefined : row.track?.motion ?? row.motion, status: row.status, etaMin: row.eta_min,
      closesInMin: row.closes_in_min, ageMin: row.age_min,
      snapshotAt: snapshotTime(row.snapshot_at == null ? undefined : row.snapshot_at * 1000, scene.cached_at) })) };
}

export function runFreshUntil(run: MapRun, now: number): number {
  const trains = run.trains ?? (run.train ? [run.train] : []);
  return Math.max(now, ...trains.map((train) => (train.snapshotAt ?? now) +
    (train.movement === "stopped" ? Math.max(0, 8 - (train.ageMin ?? 0)) * 60 : train.motion?.valid_for_sec ?? 120) * 1000));
}

const LAT_M = 110570;
export const ROAD_HALF_M = 70;
export const ROAD_GAP_M = 16;
export const BARRIER_OFFSET_M = 28;
export const BARRIER_HALF_M = 13;

function eastScale(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export function toPlane(point: LngLat, origin: LngLat): Plane {
  return {
    x: (point.lon - origin.lon) * eastScale(origin.lat),
    y: (point.lat - origin.lat) * LAT_M,
  };
}

export function fromPlane(origin: LngLat, plane: Plane): LngLat {
  return {
    lat: origin.lat + plane.y / LAT_M,
    lon: origin.lon + plane.x / eastScale(origin.lat),
  };
}

export function metresBetween(a: LngLat, b: LngLat): number {
  const plane = toPlane(b, a);
  return Math.hypot(plane.x, plane.y);
}

function add(a: Plane, b: Plane): Plane {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Plane, b: Plane): Plane {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Plane, k: number): Plane {
  return { x: v.x * k, y: v.y * k };
}

function len(v: Plane): number {
  return Math.hypot(v.x, v.y);
}

function unit(v: Plane): Plane {
  const n = len(v);
  if (n < 1e-6) return { x: 0, y: 1 };
  return { x: v.x / n, y: v.y / n };
}

function dot(a: Plane, b: Plane): number {
  return a.x * b.x + a.y * b.y;
}


function polyline(rail: [number, number][], origin: LngLat): Plane[] {
  return rail.map(([lat, lon]) => toPlane({ lat, lon }, origin));
}

function pointAt(points: Plane[], metres: number): Plane {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || metres <= 0) return points[0];
  let left = metres;
  for (let i = 1; i < points.length; i += 1) {
    const step = len(sub(points[i], points[i - 1]));
    if (step < 1e-6) continue;
    if (left <= step) return add(points[i - 1], scale(sub(points[i], points[i - 1]), left / step));
    left -= step;
  }
  return points[points.length - 1];
}

function project(points: Plane[], target: Plane): { metres: number; dir: Plane } {
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  let dir = { x: 0, y: 1 };
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const edge = sub(end, start);
    const step = len(edge);
    let t = 0;
    if (step > 1e-6) {
      t = dot(sub(target, start), edge) / (step * step);
      t = Math.max(0, Math.min(1, t));
    }
    const point = add(start, scale(edge, t));
    const offset = len(sub(point, target));
    if (offset < bestD) {
      bestD = offset;
      best = walked + step * t;
      dir = unit(edge);
    }
    walked += step;
  }
  return { metres: best, dir };
}

function bearing(dir: Plane): number {
  return (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
}

/** Booms lie along the rail and sit out on the road, so traffic stops and the track stays open. */
export function frameAt(
  rail: [number, number][],
  crossing: LngLat,
  train: MapRun["train"],
  elapsedSec: number,
  hold = false,
): RunFrame {
  const empty: RunFrame = {
    train: null,
    road: [],
    barriers: [],
    posts: [],
    clearance: 0,
    acrossRoad: 0,
    lowered: 0,
  };
  if (rail.length < 2) return empty;
  const points = polyline(rail, crossing);
  const gate = project(points, { x: 0, y: 0 });
  const track = gate.dir;
  const road = { x: -track.y, y: track.x };
  const deck = (side: number, metres: number) => fromPlane(crossing, add(pointAt(points, gate.metres), scale(road, side * metres)));
  const roadLine: [LngLat, LngLat][] = [1, -1].map((side) => [deck(side, ROAD_GAP_M), deck(side, ROAD_HALF_M)]);
  const posts = [1, -1].map((side) => deck(side, BARRIER_OFFSET_M));

  const current = train;
  const elapsed = Math.max(0, hold ? Math.floor(elapsedSec) : elapsedSec);
  const stopped = current?.movement === "stopped";
  const fresh = current != null && (current.ageMin ?? 0) + elapsed / 60 < 8 && (stopped || elapsed <= (current.motion?.valid_for_sec ?? 120));
  const travelMinutes = stopped ? 0 : elapsed / 60;
  const remaining = current?.etaMin == null ? null : current.etaMin - travelMinutes;
  const downIn = current?.closesInMin == null ? null : current.closesInMin - travelMinutes;
  const lowered = fresh && (remaining == null || remaining >= -2) &&
    (current.status === "closed" || (current.status === "closing_soon" && downIn != null && downIn <= 0)) ? 1 : 0;
  const reach = BARRIER_HALF_M * lowered;
  const barriers: [LngLat, LngLat][] = [];
  if (reach > 0.4) {
    for (const side of [1, -1]) {
      const center = add(pointAt(points, gate.metres), scale(road, side * BARRIER_OFFSET_M));
      barriers.push([
        fromPlane(crossing, add(center, scale(track, reach))),
        fromPlane(crossing, add(center, scale(track, -reach))),
      ]);
    }
  }

  let marker: RunFrame["train"] = null;
  const motion = stopped ? undefined : current?.motion;
  const moving = motion && Math.abs(motion.direction) === 1 && Number.isFinite(motion.speed_kmh) && motion.speed_kmh > 0 && remaining != null;
  const total = points.slice(1).reduce((sum, point, i) => sum + len(sub(point, points[i])), 0);
  const metres = moving ? gate.metres - motion.direction * motion.speed_kmh * remaining * 1000 / 60 : (current?.alongKm ?? 0) * 1000;
  if (current && fresh && (remaining == null || remaining >= -2) && (moving || current.onSegment === true) && Number.isFinite(metres) && metres >= 0 && metres <= total) {
    const sign = moving ? motion.direction : Math.sign(gate.metres - metres) || 1;
    const at = pointAt(points, metres);
    const ahead = pointAt(points, metres + sign * 25);
    const step = sub(ahead, at);
    const face = len(step) > 1 ? unit(step) : scale(track, sign);
    const spot = fromPlane(crossing, at);
    marker = { lat: spot.lat, lon: spot.lon, bearing: bearing(face) };
  }

  let clearance = BARRIER_OFFSET_M;
  let acrossRoad = 1;
  if (barriers.length > 0) {
    const a = toPlane(barriers[0][0], crossing);
    const b = toPlane(barriers[0][1], crossing);
    const boom = unit(sub(b, a));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    clearance = len(sub(mid, pointAt(points, gate.metres)));
    acrossRoad = Math.abs(dot(boom, track));
  }

  return {
    train: marker,
    road: roadLine,
    barriers,
    posts,
    clearance,
    acrossRoad,
    lowered,
  };
}
