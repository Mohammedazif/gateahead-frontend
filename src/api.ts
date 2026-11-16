import { installationId, readStored, writeStored } from "./features";

export type SnapshotInfo = { cached_at?: number; offline?: boolean };

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
};

export type Approach = {
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

export type Sighting = {
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
export type Passed = {
  train: string;
  name: string;
  cluster: string;
  ago: number;
  from_you_km: number;
  lat: number;
  lon: number;
  ids?: string[];
};

export type GatePrediction = { id: string; train: string; name: string; eta: number; closes_in?: number; status: string; basis?: string; age_min?: number };

export type Predict = SnapshotInfo & {
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

export type SceneTrain = {
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
  available: boolean;
  error?: string;
  crossing?: { id: string; name: string; lat: number; lon: number };
  rail: [number, number][];
  trains: SceneTrain[];
  passed?: { number: string; name: string; ago_min: number }[];
};

export class RequestError extends Error {
  constructor(message: string, public retryAt = 0) { super(message); }
}

type CachedResponse = { at: number; data: Record<string, unknown> };
export function cachedResponse(path: string): CachedResponse | null {
  const all = readStored<Record<string, CachedResponse>>("responses", {});
  const hit = all[path];
  return hit && Number.isFinite(hit.at) && hit.data && typeof hit.data === "object" ? hit : null;
}

async function getJson<T>(path: string, signal?: AbortSignal, freshAfter = 0): Promise<T> {
  const cacheable = /^\/api\/(gates|predict|scene)\?/.test(path);
  const saved = cacheable ? cachedResponse(path) : null;
  if (path.startsWith("/api/scene?") && saved && Date.now() - saved.at < 90000 && saved.at >= freshAfter) {
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
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After")) || 600;
    const retryAt = Date.now() + seconds * 1000;
    writeStored("paused-until", retryAt);
    throw new RequestError("Too many checks. Automatic checks are paused; try again in a few minutes.", retryAt);
  }
  if (!response.ok) {
    if (saved && response.status >= 500) return { ...saved.data, cached_at: saved.at, offline: true } as T;
    throw new RequestError("Could not reach the service. Try again in a moment.");
  }
  const data = await response.json();
  const fetchedAt = Date.now();
  if (cacheable && data.error && saved) return { ...saved.data, cached_at: saved.at, offline: true } as T;
  if (cacheable && !data.error) {
    const all = readStored<Record<string, CachedResponse>>("responses", {});
    all[path] = { at: fetchedAt, data };
    const recent = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 24);
    writeStored("responses", Object.fromEntries(recent));
  }
  return (cacheable && !data.error ? { ...data, cached_at: fetchedAt, offline: false } : data) as T;
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
  return response.json();
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
