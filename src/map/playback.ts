export type LngLat = { lat: number; lon: number };
export type Plane = { x: number; y: number };

export type MapRun = {
  id: string;
  rail: [number, number][];
  crossing: LngLat;
  train: { alongKm: number; status: string } | null;
};

export type RunFrame = {
  train: { lat: number; lon: number; bearing: number } | null;
  road: [LngLat, LngLat][];
  barriers: [LngLat, LngLat][];
  posts: LngLat[];
  clearance: number;
  acrossRoad: number;
  lowered: number;
};

const LAT_M = 110570;
export const PLAY_SECONDS = 14;
export const ROAD_HALF_M = 70;
export const ROAD_GAP_M = 16;
export const BARRIER_OFFSET_M = 28;
export const BARRIER_HALF_M = 13;
const PAST_M = 160;

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function loweredAmount(status: string, elapsed: number, progress: number, hold: boolean): number {
  if (status === "closed" || status === "closing_soon") {
    return hold ? 1 : clamp01(elapsed / 2.4);
  }
  if (status === "approaching") {
    if (hold) return progress > 0.65 ? 1 : 0;
    return clamp01((progress - 0.4) / 0.3);
  }
  return 0;
}

/** Booms lie along the rail and sit out on the road, so traffic stops and the track stays open. */
export function frameAt(
  rail: [number, number][],
  crossing: LngLat,
  train: { alongKm: number; status: string } | null,
  elapsedSec: number,
  hold: boolean,
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

  const progress = hold ? 0 : clamp01(elapsedSec / PLAY_SECONDS);
  const eased = 1 - (1 - progress) ** 2;
  const lowered = train ? loweredAmount(train.status, elapsedSec, progress, hold) : 0;
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
  if (train) {
    const start = train.alongKm * 1000;
    const sign = Math.sign(gate.metres - start) || 1;
    const end = gate.metres + sign * PAST_M;
    const metres = hold ? start : start + (end - start) * eased;
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
