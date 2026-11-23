import { runKey } from "./runIdentity";
import type { Gate, Predict, Scene } from "./api";

export type Place = { lat: number; lon: number; label?: string };
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
  return p != null && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 &&
    (p.label == null || typeof p.label === "string");
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

export function withGateChecks(predict: Predict | null, scenes: Scene[], mappedGates: Gate[] = []): Predict | null {
  if (!predict?.gate_predictions) return predict;
  let exact = [...predict.gate_predictions];
  let awaiting = [...(predict.awaiting_update ?? [])];
  const updates = new Map((predict.service_updates ?? []).map((row) => [runKey(row), row]));
  for (const scene of scenes) {
    const gate = scene.crossing;
    if (!gate || !scene.available || (scene.cached_at ?? 0) < (predict.cached_at ?? 0)) continue;
    for (const row of scene.trains) updates.delete(runKey(row));
    for (const row of scene.service_updates ?? []) updates.set(runKey(row), row);
    exact = exact.filter((row) => row.id !== gate.id);
    awaiting = awaiting.flatMap((row) => {
      const ids = row.ids?.filter((id) => id !== gate.id);
      return ids?.length ? [{ ...row, ids }] : row.ids ? [] : [row];
    });
    awaiting.push(...(scene.awaiting_update ?? []));
    exact.push(...scene.trains.map((row) => ({ id: gate.id, train: row.number, run_id: row.run_id, start_date: row.start_date, name: row.name,
      eta: row.eta_min, closes_in: row.closes_in_min, status: row.status, basis: row.basis, age_min: row.age_min,
      at_station: row.movement === "stopped" })));
  }
  exact = exact.filter((row) => !updates.has(runKey(row)));
  awaiting = awaiting.filter((row) => !updates.has(runKey(row)));
  const approaching = predict.approaching.flatMap((row) => {
    const gates = exact.filter((gate) => runKey(gate) === runKey(row) && row.ids?.includes(gate.id));
    if (!gates.length) return [];
    const first = gates.reduce((a, b) => a.eta < b.eta ? a : b);
    return [{ ...row, eta: first.eta, closes_in: first.closes_in, status: first.status, ids: gates.map((gate) => gate.id), count: gates.length }];
  });
  for (const row of exact) {
    if (approaching.some((group) => runKey(group) === runKey(row) && group.ids?.includes(row.id))) continue;
    const gate = mappedGates.find((gate) => gate.id === row.id);
    if (!gate) continue;
    approaching.push({ train: row.train, run_id: row.run_id, start_date: row.start_date, name: row.name, cluster: gate.name, count: 1, ids: [row.id],
      eta: row.eta, closes_in: row.closes_in, status: row.status, basis: row.basis, age_min: row.age_min,
      at_station: row.at_station ?? false, current: "", from_you_km: gate.km, lat: gate.lat, lon: gate.lon });
  }
  const merged = new Map<string, NonNullable<Predict["awaiting_update"]>[number]>();
  for (const row of awaiting) {
    const previous = merged.get(runKey(row));
    merged.set(runKey(row), { ...row, ids: [...new Set([...(previous?.ids ?? []), ...(row.ids ?? [])])] });
  }
  return { ...predict, gate_predictions: exact, approaching, awaiting_update: [...merged.values()], service_updates: [...updates.values()] };
}

export function markGates(gates: Gate[], predict: Predict | null, checked: Scene | Scene[] | null = null): Gate[] {
  const marks = new Map<string, { status: string; eta: number; closes_in?: number }>();
  const rows = predict?.gate_predictions ?? (predict?.approaching ?? [])
    .filter((row) => row.ids?.length === 1).map((row) => ({ ...row, id: row.ids![0] }));
  for (const row of rows) {
    const previous = marks.get(row.id);
    if (!previous || row.eta < previous.eta) marks.set(row.id, row);
  }
  const grouped = new Set(predict?.gate_predictions == null ? predict?.approaching.flatMap((row) => row.ids ?? []) : []);
  const uncertain = new Set(predict?.awaiting_update?.flatMap((row) => row.ids ?? []) ?? []);
  for (const scene of Array.isArray(checked) ? checked : checked ? [checked] : []) {
    const checkedGate = scene.available && (scene.cached_at ?? 0) >= (predict?.cached_at ?? 0) ? scene.crossing?.id : null;
    if (!checkedGate) continue;
    // Returning to Nearby must retain the newer result of the gate just opened.
    marks.delete(checkedGate);
    grouped.delete(checkedGate);
    uncertain.delete(checkedGate);
    if (scene.awaiting_update?.length) uncertain.add(checkedGate);
    const lead = scene.trains[0];
    if (lead) marks.set(checkedGate, { status: lead.status, eta: lead.eta_min, closes_in: lead.closes_in_min });
  }
  return gates.map((gate) => {
    const { status: _status, eta: _eta, closesIn: _closesIn, groupEstimate: _group, ...base } = gate;
    if (uncertain.has(gate.id)) return { ...base, status: "uncertain" };
    const mark = marks.get(gate.id);
    return mark ? { ...base, status: mark.status, eta: mark.eta, closesIn: mark.closes_in }
      : grouped.has(gate.id) ? { ...base, status: "approaching", groupEstimate: true } : base;
  });
}
