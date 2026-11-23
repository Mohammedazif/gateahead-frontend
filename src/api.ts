import type { RunIdentity } from "./runIdentity";
import { installationId, readStored, writeStored } from "./features";

export type SnapshotInfo = { cached_at?: number; offline?: boolean };

export type TrainCoverage = {
  live_checked: number;
  live_candidates: number;
  pending_live: number;
  unavailable_live?: number;
  missing_or_stale_routes: number;
  unavailable_discovery?: number;
};

export type AwaitingTrain = RunIdentity & {
  number: string;
  name: string;
  current: string;
  last_station?: string;
  age_min: number;
  reason: "stopped_report";
  ids?: string[];
};

export type Gate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  km: number;
  source: string;
  status?: string;
  eta?: number;
  closesIn?: number;
  groupEstimate?: boolean;
  /** Shared only by mapped points on the same physical public-road crossing. */
  group_id?: string;
  group_name?: string;
  group_size?: number;
  road?: string;
  area?: string;
  /** Older responses and saved gates may have included restricted freight sites. */
  restricted_freight?: boolean;
};

export type Approach = RunIdentity & {
  age_min?: number;
  basis?: string;
  train: string;
  name: string;
  cluster: string;
  count: number;
  /** Minutes until the train reaches the crossing. */
  eta: number;
  /** Estimated minutes until the barrier comes down; zero or less predicts closure. */
  closes_in?: number;
  status: string;
  at_station: boolean;
  current: string;
  from_you_km: number;
  lat: number;
  lon: number;
  ids?: string[];
  bracket?: string;
  origin?: string;
  dest?: string;
  next?: string;
  next_in?: string;
  departed_at?: string;
  scheduled_at?: string;
  platform?: string;
  left_km?: number;
  run?: string;
  delay?: number;
};

export type Sighting = RunIdentity & {
  number: string;
  name: string;
  current: string;
  delay: number;
  age: number;
  eta: number | null;
  passed_local: boolean;
  at_station?: boolean;
  origin?: string;
  dest?: string;
  next?: string;
  next_in?: string;
  departed_at?: string;
  scheduled_at?: string;
  platform?: string;
  left_km?: number;
  run?: string;
};

/** A train that went over a crossing near you in the last few minutes. */
export type Passed = RunIdentity & {
  train: string;
  name: string;
  cluster: string;
  ago: number;
  from_you_km: number;
  lat: number;
  lon: number;
  ids?: string[];
};

export type GatePrediction = RunIdentity & { id: string; train: string; name: string; eta: number; closes_in?: number; status: string; basis?: string; age_min?: number; at_station?: boolean };

export type ServiceUpdate = RunIdentity & { number: string; status: "cancelled" | "diverted" | "partially_cancelled"; notice: string };

export type Predict = SnapshotInfo & {
  service_updates?: ServiceUpdate[];
  awaiting_update?: AwaitingTrain[];
  coverage?: TrainCoverage;
  gate_predictions?: GatePrediction[];
  generated_at?: string;
  refresh_after_seconds?: number;
  error?: string;
  crossings: number;
  stations: string[];
  checked: number;
  running: number;
  approaching: Approach[];
  passed?: Passed[];
  sightings: Sighting[];
};

export type SceneTrain = RunIdentity & {
  current?: string;
  last_station?: string;
  track?: { estimated: boolean; rail: [number, number][]; along_km: number; position_on_segment: boolean; motion?: { direction: number; speed_kmh: number; valid_for_sec: number } };
  movement?: "moving" | "stopped";
  snapshot_at?: number;
  motion?: { direction: number; speed_kmh: number; valid_for_sec: number };
  position_on_segment?: boolean;
  basis?: string;
  number: string;
  name: string;
  eta_min: number;
  closes_in_min?: number;
  status: string;
  along_km: number;
  age_min: number;
  bracket?: string;
};

export type Scene = SnapshotInfo & {
  service_updates?: ServiceUpdate[];
  awaiting_update?: AwaitingTrain[];
  coverage?: TrainCoverage;
  available: boolean;
  error?: string;
  crossing?: { id: string; name: string; lat: number; lon: number };
  rail: [number, number][];
  trains: SceneTrain[];
  passed?: (RunIdentity & { number: string; name: string; ago_min: number })[];
};

export class RequestError extends Error {
  constructor(message: string, public retryAt = 0) { super(message); }
}

type CachedResponse = { at: number; data: Record<string, unknown> };
type PendingCache = { count: number; storedVersion: number };
const pendingCache = new Map<string, PendingCache>();
let requestVersion = 0;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasResponseShape(path: string, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const finite = (item: unknown) => typeof item === "number" && Number.isFinite(item);
  const text = (row: Record<string, unknown>, keys: string[]) => keys.every((key) => row[key] == null || typeof row[key] === "string");
  const numbers = (row: Record<string, unknown>, keys: string[]) => keys.every((key) => row[key] == null || finite(row[key]));
  const ids = (item: unknown) => item == null || (Array.isArray(item) && item.every((id) => typeof id === "string"));
  const rows = (items: unknown, valid: (row: Record<string, unknown>) => boolean) => Array.isArray(items) && items.every((row) => isRecord(row) && valid(row));
  const optionalRows = (items: unknown, valid: (row: Record<string, unknown>) => boolean) => items == null || rows(items, valid);
  const rail = (points: unknown) => Array.isArray(points) && points.every((point) =>
    Array.isArray(point) && point.length >= 2 && finite(point[0]) && finite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180);
  const place = (row: Record<string, unknown>) => finite(row.lat) && finite(row.lon) && Math.abs(row.lat as number) <= 90 && Math.abs(row.lon as number) <= 180;
  const motion = (item: unknown) => item == null || (isRecord(item) && (item.direction === 1 || item.direction === -1) &&
    finite(item.speed_kmh) && (item.speed_kmh as number) > 0 && finite(item.valid_for_sec) && (item.valid_for_sec as number) >= 0);
  const common = (row: Record<string, unknown>) => text(row, ["run_id", "start_date", "name", "current", "last_station", "cluster", "basis", "bracket", "origin", "dest", "next", "next_in", "departed_at", "scheduled_at", "platform", "run"])
    && numbers(row, ["age_min", "age", "delay", "count", "from_you_km", "lat", "lon", "left_km", "closes_in", "closes_in_min"])
    && ids(row.ids) && (row.at_station == null || typeof row.at_station === "boolean");
  const estimated = (row: Record<string, unknown>, identity: string, eta: string) => common(row) && typeof row[identity] === "string" &&
    typeof row.status === "string" && finite(row[eta]);
  const awaiting = (row: Record<string, unknown>) => common(row) && typeof row.number === "string" && typeof row.current === "string" && finite(row.age_min);
  const coverage = value.coverage;
  if (!optionalRows(value.service_updates, (row) => typeof row.number === "string" &&
    text(row, ["run_id", "start_date", "notice"]) && ["cancelled", "diverted", "partially_cancelled"].includes(row.status as string))) return false;
  if (coverage != null && (!isRecord(coverage) || !numbers(coverage, ["live_checked", "live_candidates", "pending_live", "missing_or_stale_routes", "unavailable_live", "unavailable_discovery"]))) return false;
  if (path.startsWith("/api/gates?")) return rows(value.gates, (gate) =>
    typeof gate.id === "string" && typeof gate.name === "string" && place(gate) && finite(gate.km) &&
    text(gate, ["group_id", "group_name", "road", "area"]) && (gate.group_size == null ||
      (Number.isInteger(gate.group_size) && (gate.group_size as number) > 0)));
  if (path.startsWith("/api/predict?")) return (value.generated_at == null ||
    (typeof value.generated_at === "string" && Number.isFinite(Date.parse(value.generated_at)))) && rows(value.approaching, (row) => estimated(row, "train", "eta")) &&
    rows(value.sightings, (row) => common(row) && typeof row.number === "string" && (row.eta == null || finite(row.eta))) &&
    optionalRows(value.gate_predictions, (row) => estimated(row, "train", "eta") && typeof row.id === "string") &&
    optionalRows(value.passed, (row) => common(row) && typeof row.train === "string" && finite(row.ago)) &&
    optionalRows(value.awaiting_update, awaiting);
  if (path.startsWith("/api/scene?")) {
    if (value.crossing != null && (!isRecord(value.crossing) || typeof value.crossing.id !== "string" || !text(value.crossing, ["name"]) || !place(value.crossing))) return false;
    return typeof value.available === "boolean" && rail(value.rail) && rows(value.trains, (row) => {
      if (!estimated(row, "number", "eta_min") || !finite(row.age_min) || !finite(row.along_km) || !numbers(row, ["snapshot_at"]) || !motion(row.motion)) return false;
      if (row.snapshot_at != null && Math.abs(row.snapshot_at as number) > 8.64e12) return false;
      if (row.movement != null && row.movement !== "moving" && row.movement !== "stopped") return false;
      if (row.position_on_segment != null && typeof row.position_on_segment !== "boolean") return false;
      const track = row.track;
      return track == null || (isRecord(track) && rail(track.rail) && finite(track.along_km) && typeof track.position_on_segment === "boolean" && motion(track.motion));
    }) && optionalRows(value.passed, (row) => common(row) && typeof row.number === "string" && finite(row.ago_min)) &&
      optionalRows(value.awaiting_update, awaiting);
  }
  if (path.startsWith("/api/reports")) return (value.verified == null || value.verified === false) && rows(value.reports, (row) =>
    ["open", "closed", "wrong_location"].includes(row.state as string) && finite(row.at) && finite(row.expires_at));
  if (path.startsWith("/api/cities?")) return rows(value.cities, (row) => typeof row.name === "string" && typeof row.state === "string" && place(row));
  if (path.startsWith("/api/place?")) return value.name == null || typeof value.name === "string";
  return true;
}

function serviceErrorBody(path: string, body: Record<string, unknown>): Record<string, unknown> {
  if (!body.error) return body;
  if (typeof body.error !== "string") throw new Error("Invalid service error");
  if (path.startsWith("/api/gates?")) return { ...body, gates: [] };
  if (path.startsWith("/api/predict?")) return { ...body, approaching: [], sightings: [], gate_predictions: [], passed: [], awaiting_update: [] };
  if (path.startsWith("/api/scene?")) return { ...body, available: false, rail: [], trains: [], passed: [], awaiting_update: [] };
  return body;
}

function publicGateResponse(path: string, body: Record<string, unknown>): Record<string, unknown> {
  if (!path.startsWith("/api/gates?") || !Array.isArray(body.gates)) return body;
  return { ...body, gates: body.gates.filter((gate) => gate.restricted_freight !== true) };
}

function responseCache(): Record<string, CachedResponse> {
  const raw = readStored<unknown>("responses", {});
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, CachedResponse] => {
    const hit = entry[1];
    return isRecord(hit) && typeof hit.at === "number" && Number.isFinite(hit.at) &&
      hasResponseShape(entry[0], hit.data) && !hit.data.error;
  }));
}

export function cachedResponse(path: string): CachedResponse | null {
  const hit = responseCache()[path];
  return hit ? { ...hit, data: publicGateResponse(path, hit.data) } : null;
}

async function getJson<T>(path: string, signal?: AbortSignal, freshAfter = 0): Promise<T> {
  signal?.throwIfAborted();
  const cacheable = /^\/api\/(gates|predict|scene)\?/.test(path);
  const pending = cacheable ? pendingCache.get(path) ?? { count: 0, storedVersion: 0 } : null;
  const version = ++requestVersion;
  if (pending) { pending.count++; pendingCache.set(path, pending); }
  try {
    const saved = cacheable ? cachedResponse(path) : null;
    if (path.startsWith("/api/scene?") && saved && Date.now() >= saved.at && Date.now() - saved.at < 90000 && saved.at >= freshAfter) {
      return { ...saved.data, cached_at: saved.at, offline: false } as T;
    }
    const pausedUntil = readStored<number>("paused-until", 0);
    if (/^\/api\/(predict|scene)\?/.test(path) && pausedUntil > Date.now()) {
      if (saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("Checks are paused. Try again in a few minutes.", pausedUntil);
    }
    let response: Response;
    try {
      response = await fetch(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("Could not reach the service. Check your connection and try again.");
    }
    signal?.throwIfAborted();
    if (response.status === 429) {
      const now = Date.now();
      const header = response.headers.get("Retry-After")?.trim() ?? "";
      const seconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
      const date = /[a-z]/i.test(header) ? Date.parse(header) : NaN;
      const retryAt = Number.isFinite(seconds) ? now + seconds * 1000 : Number.isFinite(date) ? Math.max(now, date) : now + 600000;
      writeStored("paused-until", retryAt);
      throw new RequestError("Too many checks. Automatic checks are paused; try again in a few minutes.", retryAt);
    }
    if (!response.ok) {
      if (saved && response.status >= 500) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("Could not reach the service. Try again in a moment.");
    }
    let data: Record<string, unknown>;
    try {
      const body: unknown = await response.json();
      signal?.throwIfAborted();
      if (!isRecord(body)) throw new Error("Invalid response body");
      data = serviceErrorBody(path, body);
      if (!hasResponseShape(path, data)) throw new Error("Invalid response fields");
      data = publicGateResponse(path, data);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("The service returned an unreadable response. Try again in a moment.");
    }
    const fetchedAt = Date.now();
    if (cacheable && data.error && saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
    if (cacheable && !data.error && pending && version >= pending.storedVersion) {
      const all = responseCache();
      all[path] = { at: fetchedAt, data };
      const recent = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 24);
      writeStored("responses", Object.fromEntries(recent));
      pending.storedVersion = version;
    }
    return (cacheable && !data.error ? { ...data, cached_at: fetchedAt, offline: false } : data) as T;
  } finally {
    if (pending && --pending.count === 0) pendingCache.delete(path);
  }
}

export type GateReports = { verified: false; reports: { state: string; at: number; expires_at: number }[] };
export function fetchReports(id: string): Promise<GateReports> {
  return getJson(`/api/reports?crossing_id=${encodeURIComponent(id)}`);
}
export async function submitReport(gate: Gate, state: string): Promise<GateReports> {
  const response = await fetch("/api/reports", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ crossing_id: gate.id, installation_id: installationId(), state, lat: gate.lat, lon: gate.lon }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Too many reports. Try again in a few minutes." : "Could not send your report. Try again later.");
  try {
    const body: unknown = await response.json();
    if (!hasResponseShape("/api/reports", body)) throw new Error("Invalid report response");
    return body as GateReports;
  } catch { throw new RequestError("The service returned an unreadable report. Try again in a moment."); }
}

export type City = {
  name: string;
  state: string;
  lat: number;
  lon: number;
};

export function fetchCities(query: string, signal?: AbortSignal): Promise<City[]> {
  return getJson<{ cities?: City[] }>(`/api/cities?q=${encodeURIComponent(query)}`, signal).then(
    (body) => body.cities ?? [],
  );
}

export function fetchPlaceName(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<{ name: string | null }> {
  return getJson(`/api/place?lat=${lat}&lon=${lon}`, signal);
}

export function fetchGates(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SnapshotInfo & { gates: Gate[]; error?: string }> {
  return getJson(`/api/gates?lat=${lat}&lon=${lon}`, signal);
}

export function fetchPredict(lat: number, lon: number, signal?: AbortSignal): Promise<Predict> {
  return getJson(`/api/predict?lat=${lat}&lon=${lon}`, signal);
}

export function fetchScene(lat: number, lon: number, crossingId: string, signal?: AbortSignal, freshAfter = 0): Promise<Scene> {
  const id = encodeURIComponent(crossingId);
  return getJson(`/api/scene?lat=${lat}&lon=${lon}&crossing_id=${id}`, signal, freshAfter);
}

export function friendlyError(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again in a moment.";
  if (/429|502|504|timeout|timed out|busy|map_busy/i.test(message)) {
    return "The crossing list is busy. Wait a minute and try again.";
  }
  if (/406|overpass|map_unavailable|could not reach|invalid data/i.test(message)) {
    return "The crossing list did not load. Try again in a minute.";
  }
  if (message === "crossing_not_found") return "That crossing is no longer on the map.";
  return message;
}
