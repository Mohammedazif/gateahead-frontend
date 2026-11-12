export type LngLat = { lat: number; lon: number };
export type Vec3 = { x: number; y: number; z: number };

const METRES_PER_DEG_LAT = 110570;

export function toLocal(point: LngLat, origin: LngLat): Vec3 {
  const east = (point.lon - origin.lon) * 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const north = (point.lat - origin.lat) * METRES_PER_DEG_LAT;
  return { x: east, y: 0, z: -north };
}

export function polylineLocal(rail: [number, number][], origin: LngLat): Vec3[] {
  return rail.map(([lat, lon]) => toLocal({ lat, lon }, origin));
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: 0, z: a.z - b.z };
}

function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: 0, z: v.z * k };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: 0, z: a.z + b.z };
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.z);
  if (n < 1e-6) return { x: 0, y: 0, z: -1 };
  return { x: v.x / n, y: 0, z: v.z / n };
}

export function pathMetres(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  return total;
}

export function pointAtMetres(points: Vec3[], metres: number): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1 || metres <= 0) return points[0];
  let left = metres;
  for (let i = 1; i < points.length; i += 1) {
    const step = dist(points[i - 1], points[i]);
    if (step < 1e-6) continue;
    if (left <= step) return add(points[i - 1], scale(sub(points[i], points[i - 1]), left / step));
    left -= step;
  }
  return points[points.length - 1];
}

export function chainageKm(points: Vec3[], target: Vec3): number {
  if (points.length < 2) return 0;
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const step = dist(start, end);
    let t = 0;
    if (step > 1e-6) {
      const vx = end.x - start.x;
      const vz = end.z - start.z;
      t = ((target.x - start.x) * vx + (target.z - start.z) * vz) / (step * step);
      t = Math.max(0, Math.min(1, t));
    }
    const point = add(start, scale(sub(end, start), t));
    const offset = dist(point, target);
    if (offset < bestD) {
      bestD = offset;
      best = walked + step * t;
    }
    walked += step;
  }
  return best / 1000;
}

/** Yaw so a mesh whose nose is local −z faces `dir`. */
export function yawFacing(dir: Vec3): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** Lay a +Y boom along the track. The road runs across local X, so this blocks traffic. */
export function barrierDrop(side: 1 | -1): number {
  return (side * Math.PI) / 2;
}

/** Camera sits beside the road, back from the gate, looking along the track. */
export function placeCamera(at: Vec3, look: Vec3): { position: Vec3; target: Vec3 } {
  const sideX = -look.z;
  const sideZ = look.x;
  return {
    position: {
      x: at.x + sideX * 16 + look.x * -18,
      y: 5.2,
      z: at.z + sideZ * 16 + look.z * -18,
    },
    target: {
      x: at.x + look.x * 28,
      y: 1.2,
      z: at.z + look.z * 28,
    },
  };
}

/** Move the reported chainage toward the gate. A stale report stays where it was. */
export function trainKm(alongKm: number, gateKm: number, etaMin: number, elapsedMin: number, hold: boolean): number {
  if (hold || etaMin <= 0.05) return alongKm;
  const t = Math.min(0.97, Math.max(0, elapsedMin) / etaMin);
  return alongKm + (gateKm - alongKm) * t;
}

export function sample(points: Vec3[], km: number, towardKm: number): { point: Vec3; dir: Vec3 } {
  const metres = Math.max(0, km) * 1000;
  const point = pointAtMetres(points, metres);
  const sign = towardKm < km ? -1 : 1;
  const ahead = pointAtMetres(points, metres + sign * 4);
  const delta = sub(ahead, point);
  if (Math.hypot(delta.x, delta.z) < 0.05) {
    const fallback = sign < 0 ? sub(points[0], points[points.length - 1]) : sub(points[points.length - 1], points[0]);
    return { point, dir: normalize(fallback) };
  }
  return { point, dir: normalize(delta) };
}
