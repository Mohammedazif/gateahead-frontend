import type { RunIdentity } from "./runIdentity";
import { installationId, readStored, writeStored } from "./features";

export type SnapshotInfo = { cached_at?: number; offline?: boolean };
export type MapAvailability = { map_warning?: string; map_age_seconds?: number };

export type TrainCoverage = {
  status?: "partial" | "complete" | "unknown";
  live_checked: number;
  live_candidates: number;
  pending_live: number;
  unavailable_live?: number;
  missing_or_stale_routes: number;
  unavailable_discovery?: number;
  limited?: boolean;
};

export type AwaitingTrain = RunIdentity & {
  number: string;
  name: string;
  current: string;
  last_station?: string;
  age_min: number;
  reason: "stopped_report" | "stale_report" | "unknown_report_age" | "estimate_elapsed";
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
  positionUncertain?: boolean;
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
  observed?: boolean;
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
  observed?: boolean;
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

export type GatePrediction = RunIdentity & { id: string; train: string; name: string; eta: number; closes_in?: number; status: string; basis?: string; age_min?: number; at_station?: boolean; observed?: boolean };

export type ServiceUpdate = RunIdentity & { number: string; status: "cancelled" | "diverted" | "partially_cancelled"; notice: string };

export type Predict = SnapshotInfo & MapAvailability & {
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
  observed?: boolean;
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

export type AccessStatus = "allowed" | "restricted" | "unknown";
export type CrossingBypass = { kind: "flyover" | "underpass"; name: string; lat: number; lon: number; verified_on: string; replacement?: boolean };
export type CrossingAccess = {
  cars: AccessStatus;
  two_wheelers: AccessStatus;
  pedestrians: AccessStatus;
  source: "mapped" | "verified" | "unavailable";
  verified_on?: string;
  bypasses: CrossingBypass[];
};

type CrossingPoint = { id: string; name: string; lat: number; lon: number };
export type CrossingDetails = SnapshotInfo & MapAvailability & {
  crossing?: CrossingPoint;
  crossing_access?: CrossingAccess;
  legacy_alias_resolved?: boolean;
  error?: string;
};

export type Scene = SnapshotInfo & MapAvailability & {
  service_updates?: ServiceUpdate[];
  awaiting_update?: AwaitingTrain[];
  coverage?: TrainCoverage;
  available: boolean;
  error?: string;
  legacy_alias_resolved?: boolean;
  active_at_check?: string[];
  crossing?: CrossingPoint;
  crossing_access?: CrossingAccess;
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
const sessionResponses = new Map<string, CachedResponse>();
let requestVersion = 0;
let sessionTrainPause = 0;

export function trainPauseUntil(): number {
  const stored = readStored<number>("paused-until", 0);
  return Math.max(sessionTrainPause, Number.isFinite(stored) && stored < 8.64e15 ? stored : 0);
}

function pauseTrainChecks(retryAt: number): number {
  const until = Math.max(trainPauseUntil(), retryAt);
  sessionTrainPause = writeStored("paused-until", until) ? 0 : until;
  return until;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function accessStatus(value: unknown): value is AccessStatus {
  return value === "allowed" || value === "restricted" || value === "unknown";
}

function verificationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Math.floor((Date.now() + 330 * 60 * 1000) / dayMs);
  const date = Math.floor(parsed / dayMs);
  return date <= today && date >= today - 365;
}

function crossingAccess(value: unknown): CrossingAccess | undefined {
  if (!isRecord(value)) return undefined;
  const { cars, two_wheelers, pedestrians, source, verified_on } = value;
  if (!accessStatus(cars) || !accessStatus(two_wheelers) || !accessStatus(pedestrians) ||
      (source !== "mapped" && source !== "verified" && source !== "unavailable")) return undefined;
  const bypasses: CrossingBypass[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(value.bypasses) ? value.bypasses : []) {
    if (!isRecord(row) || (row.kind !== "flyover" && row.kind !== "underpass") ||
        typeof row.name !== "string" || !row.name.trim() ||
        typeof row.lat !== "number" || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90 ||
        typeof row.lon !== "number" || !Number.isFinite(row.lon) || Math.abs(row.lon) > 180 ||
        !verificationDate(row.verified_on)) continue;
    const key = `${row.kind}:${row.lat}:${row.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bypasses.push({ kind: row.kind, name: row.name, lat: row.lat, lon: row.lon,
      verified_on: row.verified_on, replacement: row.replacement === true });
    if (bypasses.length === 5) break;
  }
  if (source === "verified" && verificationDate(verified_on)) {
    return { cars, two_wheelers, pedestrians, source, verified_on, bypasses };
  }
  if (source === "mapped" && [cars, two_wheelers, pedestrians].some((mode) => mode !== "unknown")) {
    return { cars, two_wheelers, pedestrians, source, bypasses };
  }
  return { cars: "unknown", two_wheelers: "unknown", pedestrians: "unknown", source: "unavailable", bypasses };
}

export function isLegacyCrossingId(id: string): boolean { return /^user:\d+:\d+$/.test(id); }

function crossingMatches(path: string, id: string, alias: unknown): boolean {
  const requested = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("crossing_id");
  if (!requested) return false;
  return isLegacyCrossingId(requested)
    ? alias === true && /^pin:[a-f\d]{12}4[a-f\d]{3}[89ab][a-f\d]{15}$/i.test(id)
    : id === requested;
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
    && ids(row.ids) && (row.at_station == null || typeof row.at_station === "boolean") &&
    (row.observed == null || typeof row.observed === "boolean");
  const estimated = (row: Record<string, unknown>, identity: string, eta: string) => common(row) && typeof row[identity] === "string" &&
    typeof row.status === "string" && finite(row[eta]);
  const awaiting = (row: Record<string, unknown>) => common(row) && typeof row.number === "string" && typeof row.current === "string" && finite(row.age_min);
  const coverage = value.coverage;
  if (!text(value, ["map_warning"]) || !numbers(value, ["map_age_seconds"])) return false;
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
  const isDetails = path.startsWith("/api/crossing-details?");
  if (path.startsWith("/api/scene?") || isDetails) {
    const crossing = value.crossing;
    if (crossing != null && (!isRecord(crossing) || typeof crossing.id !== "string" ||
        typeof crossing.name !== "string" || !place(crossing) ||
        !crossingMatches(path, crossing.id, value.legacy_alias_resolved))) return false;
    if (isDetails) return value.error ? typeof value.error === "string" : Boolean(crossing && crossingAccess(value.crossing_access));
    if (value.available === true && !crossing) return false;
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
  if (path.startsWith("/api/reports")) return !value.error && (value.verified == null || value.verified === false) && rows(value.reports, (row) =>
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

function publicResponse(path: string, body: Record<string, unknown>): Record<string, unknown> {
  if (path.startsWith("/api/gates?") && Array.isArray(body.gates)) {
    return { ...body, gates: body.gates.filter((gate) => gate.restricted_freight !== true) };
  }
  if (/^\/api\/(scene|crossing-details)\?/.test(path) && body.crossing_access != null) {
    return { ...body, crossing_access: body.crossing ? crossingAccess(body.crossing_access) : undefined };
  }
  return body;
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

export function cachedResponse(path: string, privateLocation = false): CachedResponse | null {
  const hit = privateLocation ? sessionResponses.get(path) : responseCache()[path];
  return hit ? { ...hit, data: publicResponse(path, hit.data) } : null;
}

export function clearPrivateResponses() { sessionResponses.clear(); }

function discardCrossingResponses(path: string, privateLocation: boolean) {
  const id = new URLSearchParams(path.slice(path.indexOf("?") + 1)).get("crossing_id");
  if (!id) return;
  const matches = (key: string) => /^\/api\/(scene|crossing-details)\?/.test(key) &&
    new URLSearchParams(key.slice(key.indexOf("?") + 1)).get("crossing_id") === id;
  for (const key of sessionResponses.keys()) if (matches(key)) sessionResponses.delete(key);
  if (privateLocation) return;
  const all = responseCache();
  const remove = Object.keys(all).filter(matches);
  if (!remove.length) return;
  for (const key of remove) delete all[key];
  writeStored("responses", all);
}

export function discardPersistedArea(lat: number, lon: number) {
  const all = responseCache();
  const remove = Object.keys(all).filter((path) => {
    const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    return query.get("lat") === String(lat) && query.get("lon") === String(lon);
  });
  if (!remove.length) return;
  for (const key of remove) delete all[key];
  writeStored("responses", all);
}

async function getJson<T>(path: string, signal?: AbortSignal, freshAfter = 0, privateLocation = false): Promise<T> {
  signal?.throwIfAborted();
  const isDetails = path.startsWith("/api/crossing-details?");
  const cacheable = isDetails || /^\/api\/(gates|predict|scene)\?/.test(path);
  const cacheKey = privateLocation ? `private:${path}` : path;
  const pending = cacheable ? pendingCache.get(cacheKey) ?? { count: 0, storedVersion: 0 } : null;
  const version = ++requestVersion;
  if (pending) { pending.count++; pendingCache.set(cacheKey, pending); }
  try {
    const saved = cacheable ? cachedResponse(path, privateLocation) : null;
    const disconnected = typeof navigator !== "undefined" && navigator.onLine === false;
    if (path.startsWith("/api/scene?") && saved && Date.now() >= saved.at && Date.now() - saved.at < 90000 && saved.at >= freshAfter) {
      return { ...saved.data, cached_at: saved.at, offline: disconnected } as T;
    }
    const trainCheck = /^\/api\/(predict|scene)\?/.test(path);
    const pausedUntil = trainPauseUntil();
    if (trainCheck && pausedUntil > Date.now()) {
      if (saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("Checks are paused. Try again in a few minutes.", pausedUntil);
    }
    let response: Response;
    try {
      const deadline = AbortSignal.timeout(isDetails ? 40000 : 90000);
      response = await fetch(path, { cache: "no-store", signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
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
      const deadline = retryAt < 8.64e15 ? retryAt : now + 600000;
      throw new RequestError(trainCheck ? "Too many checks. Automatic checks are paused; try again in a few minutes." :
        "Too many requests for this feature. Try again in a few minutes.", trainCheck ? pauseTrainChecks(deadline) : deadline);
    }
    if (isDetails && response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      signal?.throwIfAborted();
      if (isRecord(body) && (body.error === "crossing_not_found" || body.detail === "Crossing not found at this location." ||
          (isRecord(body.detail) && body.detail.code === "crossing_not_found"))) {
        discardCrossingResponses(path, privateLocation);
        return { error: "crossing_not_found" } as T;
      }
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
      data = publicResponse(path, data);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
      throw new RequestError("The service returned an unreadable response. Try again in a moment.");
    }
    const fetchedAt = Date.now();
    if (data.error === "crossing_not_found" && (isDetails || path.startsWith("/api/scene?"))) {
      discardCrossingResponses(path, privateLocation);
      return data as T;
    }
    if (cacheable && data.error && saved) {
      return { ...saved.data, cached_at: saved.at, offline: true,
        ...(typeof data.map_warning === "string" ? { map_warning: data.map_warning, map_age_seconds: data.map_age_seconds } : {}) } as T;
    }
    if (cacheable && !data.error && pending && version >= pending.storedVersion) {
      const crossing = isRecord(data.crossing) ? data.crossing : null;
      const key = data.legacy_alias_resolved === true && typeof crossing?.id === "string"
        ? path.replace(/([?&]crossing_id=)[^&]*/, `$1${encodeURIComponent(crossing.id)}`)
        : path;
      if (privateLocation) {
        sessionResponses.delete(path);
        sessionResponses.set(key, { at: fetchedAt, data });
        if (sessionResponses.size > 24) sessionResponses.delete(sessionResponses.keys().next().value!);
      } else {
        const all = responseCache();
        if (path !== key) delete all[path];
        all[key] = { at: fetchedAt, data };
        const recent = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 24);
        writeStored("responses", Object.fromEntries(recent));
      }
      pending.storedVersion = version;
    }
    if (path.startsWith("/api/reports?")) return timedReportResponse(data, response) as T;
    return (cacheable && !data.error ? { ...data, cached_at: fetchedAt, offline: false } : data) as T;
  } finally {
    if (pending && --pending.count === 0) pendingCache.delete(cacheKey);
  }
}

export type GateReports = { verified: false; reports: { state: string; at: number; expires_at: number }[]; clockOffsetMs: number };
function timedReportResponse(data: Record<string, unknown>, response: Response): GateReports {
  const serverAt = typeof data.server_time === "number" && Number.isFinite(data.server_time)
    ? data.server_time * 1000 : Date.parse(response.headers.get("Date") ?? "");
  return { ...data, clockOffsetMs: Number.isFinite(serverAt) ? serverAt - Date.now() : 0 } as GateReports;
}

export function fetchReports(id: string, signal?: AbortSignal): Promise<GateReports> {
  return getJson(`/api/reports?crossing_id=${encodeURIComponent(id)}`, signal);
}
export async function submitReport(gate: Gate, state: string): Promise<GateReports> {
  const response = await fetch("/api/reports", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ crossing_id: gate.id, installation_id: installationId(), state, lat: gate.lat, lon: gate.lon }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Too many reports. Try again in a few minutes." : "Could not send your report. Try again later.");
  try {
    const body: unknown = await response.json();
    if (!hasResponseShape("/api/reports", body) || body.error) throw new Error("Invalid report response");
    return timedReportResponse(body, response);
  } catch { throw new RequestError("The service returned an unreadable report. Try again in a moment."); }
}

export async function flagCrossingDetails(gate: Gate, signal: AbortSignal): Promise<void> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  const response = await fetch("/api/crossing-details/flags", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: deadline,
    body: JSON.stringify({ crossing_id: gate.id, installation_id: installationId(), lat: gate.lat, lon: gate.lon }),
  });
  if (!response.ok) throw new RequestError(response.status === 429 ? "Too many flags. Try again in a few minutes." : "Could not send the flag. Try again later.");
  const body: unknown = await response.json().catch(() => null);
  deadline.throwIfAborted();
  if (!isRecord(body) || body.accepted !== true) throw new RequestError("Could not confirm the flag. Try again later.");
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
  privateLocation = false,
): Promise<SnapshotInfo & MapAvailability & { gates: Gate[]; error?: string }> {
  return getJson(`/api/gates?lat=${lat}&lon=${lon}`, signal, 0, privateLocation);
}

export function fetchPredict(lat: number, lon: number, signal?: AbortSignal, privateLocation = false): Promise<Predict> {
  return getJson(`/api/predict?lat=${lat}&lon=${lon}`, signal, 0, privateLocation);
}

function crossingPath(endpoint: "scene" | "crossing-details", lat: number, lon: number, crossingId: string): string {
  return `/api/${endpoint}?lat=${lat}&lon=${lon}&crossing_id=${encodeURIComponent(crossingId)}`;
}

export function savedScenes(crossingIds: ReadonlySet<string>): Map<string, Scene> {
  const scenes = new Map<string, Scene>();
  if (!crossingIds.size) return scenes;
  for (const [path, cached] of Object.entries(responseCache())) {
    if (!path.startsWith("/api/scene?")) continue;
    const crossing = cached.data.crossing;
    if (!isRecord(crossing) || typeof crossing.id !== "string" || !crossingIds.has(crossing.id)) continue;
    if ((scenes.get(crossing.id)?.cached_at ?? -Infinity) >= cached.at) continue;
    scenes.set(crossing.id, { ...publicResponse(path, cached.data), cached_at: cached.at, offline: true } as Scene);
  }
  return scenes;
}

export function fetchScene(lat: number, lon: number, crossingId: string, signal?: AbortSignal, freshAfter = 0, privateLocation = false): Promise<Scene> {
  return getJson(crossingPath("scene", lat, lon, crossingId), signal, freshAfter, privateLocation);
}

export function fetchCrossingDetails(gate: Gate, signal: AbortSignal): Promise<CrossingDetails> {
  return getJson(crossingPath("crossing-details", gate.lat, gate.lon, gate.id), signal);
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
