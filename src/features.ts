import { runKey } from "./runIdentity";
import type { AwaitingTrain, Gate, MapAvailability, Predict, Scene, TrainCoverage } from "./api";

export type Place = { lat: number; lon: number; label?: string; privateLocation?: boolean };
export type SavedGate = { gate: Gate; label: string; place: Place };
export type RefreshSettings = { enabled: boolean; commute: boolean; start: string; end: string; weekdays: boolean };
export const defaultRefresh: RefreshSettings = { enabled: false, commute: false, start: "08:00", end: "10:00", weekdays: true };

export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(`gateahead:${key}`);
    return value == null ? fallback : JSON.parse(value) as T;
  } catch { return fallback; }
}

export function writeStored(key: string, value: unknown): boolean {
  try { localStorage.setItem(`gateahead:${key}`, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function validPlace(value: unknown): value is Place {
  const p = value as Place | null;
  return p != null && typeof p === "object" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 &&
    (p.privateLocation == null || typeof p.privateLocation === "boolean") &&
    (p.label == null || typeof p.label === "string");
}

export function initialPlace(url: string): (Place & { gateId?: string }) | null {
  const link = readLink(url);
  const value = readStored<unknown>("last-place", null);
  const saved = validPlace(value) && !value.privateLocation ? value : null;
  // Older builds stored a GPS fix without a label alongside the matching URL.
  const privateLocation = saved != null && !saved.label?.trim();
  if (link) return privateLocation && !link.gateId && !link.label && saved.lat === link.lat && saved.lon === link.lon
    ? { ...link, privateLocation: true } : link;
  return saved ? { lat: saved.lat, lon: saved.lon, label: saved.label, ...(privateLocation ? { privateLocation: true } : {}) } : null;
}

export function readRefresh(): RefreshSettings {
  const saved = readStored<Partial<RefreshSettings> | null>("refresh", null);
  const validClock = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return {
    enabled: saved?.enabled === true, commute: saved?.commute === true,
    start: validClock(saved?.start) ? saved.start : defaultRefresh.start,
    end: validClock(saved?.end) ? saved.end : defaultRefresh.end,
    weekdays: typeof saved?.weekdays === "boolean" ? saved.weekdays : defaultRefresh.weekdays,
  };
}

export function readFavorites(): SavedGate[] {
  const raw = readStored<unknown>("favorites", []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SavedGate => validPlace(item?.gate) && validPlace(item?.place) &&
    item.gate.restricted_freight !== true &&
    typeof item.gate.id === "string" && typeof item.gate.name === "string" &&
    typeof item.gate.source === "string" && Number.isFinite(item.gate.km) && item.gate.km >= 0 &&
    ["group_id", "group_name", "road", "area"].every((key) => item.gate[key] == null || typeof item.gate[key] === "string") &&
    (item.gate.group_size == null || (Number.isInteger(item.gate.group_size) && item.gate.group_size > 0)) &&
    typeof item.label === "string").slice(0, 50);
}

export function readLink(url: string): (Place & { gateId?: string }) | null {
  try {
    const params = new URL(url).searchParams;
    if (!params.get("lat")?.trim() || !params.get("lon")?.trim()) return null;
    const place = { lat: Number(params.get("lat")), lon: Number(params.get("lon")), label: params.get("name")?.slice(0, 120) || undefined };
    if (!validPlace(place)) return null;
    return { ...place, gateId: params.get("gate") || undefined };
  } catch { return null; }
}

export function gateLink(gate: Gate): string {
  const url = new URL(window.location.pathname, window.location.origin);
  url.search = new URLSearchParams({ lat: String(gate.lat), lon: String(gate.lon), gate: gate.id, name: gate.name }).toString();
  return url.toString();
}

export function inRefreshWindow(settings: RefreshSettings, now: Date): boolean {
  if (!settings.commute) return true;
  const parse = (clock: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : NaN;
  const start = parse(settings.start), end = parse(settings.end);
  if (!Number.isFinite(start + end) || start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const overnight = start > end;
  const day = overnight && minute < end ? (now.getDay() + 6) % 7 : now.getDay();
  if (settings.weekdays && (day === 0 || day === 6)) return false;
  return overnight ? minute >= start || minute < end : minute >= start && minute < end;
}

export function installationId(): string {
  const old = readStored<string>("installation", "");
  if (old) return old;
  const id = crypto.randomUUID();
  writeStored("installation", id);
  return id;
}

export function reportLabel(state: string): string {
  return state === "open" ? "Gate open" : state === "closed" ? "Gate closed" : "Location reported incorrect";
}

export function incompleteCheck(check?: (MapAvailability & { coverage?: TrainCoverage }) | null): boolean {
  const coverage = check?.coverage;
  return Boolean(check?.map_warning || coverage?.status === "partial" || coverage?.status === "unknown" || coverage?.limited ||
    (coverage && Math.max(coverage.pending_live ?? 0, coverage.unavailable_live ?? 0, coverage.unavailable_discovery ?? 0,
      coverage.missing_or_stale_routes ?? 0) > 0));
}

function removeCrossing<T extends { ids?: string[] }>(row: T, id: string): T[] {
  if (!row.ids?.includes(id)) return [row];
  const ids = row.ids.filter((other) => other !== id);
  return ids.length ? [{ ...row, ids }] : [];
}

function recentGateChecks(predict: Predict | null, scenes: Scene[]): Scene[] {
  return scenes.filter((scene) => scene.crossing && scene.available && !scene.offline && (scene.cached_at ?? 0) >= (predict?.cached_at ?? 0))
    .sort((a, b) => (a.cached_at ?? 0) - (b.cached_at ?? 0) || Number(Boolean(a.service_updates?.length)) - Number(Boolean(b.service_updates?.length)));
}

export function withGateChecks(predict: Predict | null, scenes: Scene[], mappedGates: Gate[] = []): Predict | null {
  if (!predict?.gate_predictions) return predict;
  let exact = [...predict.gate_predictions];
  let awaiting = [...(predict.awaiting_update ?? [])];
  let passed = [...(predict.passed ?? [])];
  const updates = new Map((predict.service_updates ?? []).map((row) => [runKey(row), row]));
  for (const scene of recentGateChecks(predict, scenes)) {
    const crossing = scene.crossing!;
    const gate = mappedGates.find((gate) => gate.id === crossing.id);
    const complete = !incompleteCheck(scene);
    const reasons = new Set([...scene.trains, ...(scene.awaiting_update ?? []), ...(scene.passed ?? []), ...(scene.service_updates ?? [])].map(runKey));
    const replaces = (row: Parameters<typeof runKey>[0]) => complete || reasons.has(runKey(row));
    const activeRuns = scene.active_at_check ?? scene.trains.filter((row) => row.observed !== false).map(runKey);
    for (const key of [...activeRuns, ...(scene.passed ?? []).map(runKey)]) updates.delete(key);
    for (const row of scene.service_updates ?? []) updates.set(runKey(row), row);
    exact = exact.filter((row) => row.id !== crossing.id || !replaces(row));
    awaiting = awaiting.flatMap((row) => replaces(row) ? removeCrossing(row, crossing.id) : [row]);
    passed = passed.flatMap((row) => replaces(row) ? removeCrossing(row, crossing.id) : [row]);
    awaiting.push(...(scene.awaiting_update ?? []).map((row) => ({ ...row, ids: [crossing.id] })));
    passed.push(...(scene.passed ?? []).map(({ number, ago_min, ...row }) => ({
      ...row, train: number, ago: ago_min, cluster: crossing.name, ids: [crossing.id],
      from_you_km: gate?.km ?? 0, lat: crossing.lat, lon: crossing.lon,
    })));
    exact.push(...scene.trains.map((row) => ({ id: crossing.id, train: row.number, run_id: row.run_id, start_date: row.start_date, name: row.name,
      eta: row.eta_min, closes_in: row.closes_in_min, status: row.status, basis: row.basis, age_min: row.age_min, observed: row.observed,
      at_station: row.movement === "stopped" })));
  }
  exact = exact.filter((row) => !updates.has(runKey(row)));
  awaiting = awaiting.filter((row) => !updates.has(runKey(row)));
  passed = passed.filter((row) => !updates.has(runKey(row))).sort((a, b) => a.ago - b.ago);
  const approaching = predict.approaching.flatMap((row) => {
    const gates = exact.filter((gate) => runKey(gate) === runKey(row) && row.ids?.includes(gate.id));
    if (!gates.length) return [];
    const first = gates.reduce((a, b) => a.eta < b.eta ? a : b);
    return [{ ...row, eta: first.eta, closes_in: first.closes_in, status: first.status, observed: first.observed ?? row.observed,
      basis: first.basis ?? row.basis, age_min: first.age_min ?? row.age_min, at_station: first.at_station ?? row.at_station,
      ids: gates.map((gate) => gate.id), count: gates.length }];
  });
  for (const row of exact) {
    if (approaching.some((group) => runKey(group) === runKey(row) && group.ids?.includes(row.id))) continue;
    const gate = mappedGates.find((gate) => gate.id === row.id);
    if (!gate) continue;
    approaching.push({ train: row.train, run_id: row.run_id, start_date: row.start_date, name: row.name, cluster: gate.name, count: 1, ids: [row.id],
      eta: row.eta, closes_in: row.closes_in, status: row.status, basis: row.basis, age_min: row.age_min, observed: row.observed,
      at_station: row.at_station ?? false, current: "", from_you_km: gate.km, lat: gate.lat, lon: gate.lon });
  }
  const merged = new Map<string, AwaitingTrain>();
  for (const row of awaiting) {
    const previous = merged.get(runKey(row));
    merged.set(runKey(row), { ...row, ids: [...new Set([...(previous?.ids ?? []), ...(row.ids ?? [])])] });
  }
  return { ...predict, gate_predictions: exact, approaching, passed, awaiting_update: [...merged.values()], service_updates: [...updates.values()] };
}

export function markGates(gates: Gate[], predict: Predict | null, checked: Scene | Scene[] | null = null): Gate[] {
  type Mark = { id: string; status: string; eta: number; closes_in?: number };
  const scenes = Array.isArray(checked) ? checked : checked ? [checked] : [];
  const legacy = predict?.gate_predictions == null;
  const fallbackRows = (predict?.approaching ?? []).filter((row) => row.ids?.length === 1).map((row) => ({ ...row, id: row.ids![0] }));
  const base = predict ?? { crossings: 0, stations: [], running: 0, checked: 0, approaching: [], sightings: [] };
  const current = scenes.length ? withGateChecks({ ...base, gate_predictions: predict?.gate_predictions ?? fallbackRows }, scenes, gates) : predict;
  const marks = new Map<string, Mark>();
  for (const row of current?.gate_predictions ?? fallbackRows) {
    const previous = marks.get(row.id);
    if (!previous || row.eta < previous.eta) marks.set(row.id, row);
  }
  const grouped = new Set(legacy ? predict?.approaching.flatMap((row) => row.ids ?? []) : []);
  for (const scene of recentGateChecks(predict, scenes)) {
    if (!incompleteCheck(scene)) grouped.delete(scene.crossing!.id);
  }
  const uncertain = new Set(current?.awaiting_update?.flatMap((row) => row.ids ?? []) ?? []);
  return gates.map((gate) => {
    const { status: _status, eta: _eta, closesIn: _closesIn, groupEstimate: _group, positionUncertain: _uncertain, ...clean } = gate;
    const mark = marks.get(gate.id);
    const positionUncertain = uncertain.has(gate.id);
    if (mark) return { ...clean, status: mark.status, eta: mark.eta, closesIn: mark.closes_in, positionUncertain };
    if (positionUncertain) return { ...clean, status: "uncertain" };
    return grouped.has(gate.id) ? { ...clean, status: "approaching", groupEstimate: true } : clean;
  });
}
