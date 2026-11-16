import type { Predict, Scene, SceneTrain } from "./api";
import { snapshotTime } from "./snapshotClock";

// Advance only between normal checks; saved/offline results keep their original timings.
export const ESTIMATE_WINDOW_MS = 120000;
const STOPPED_REPORT_MAX_AGE_MIN = 8;

function elapsedMinutes(at: number | undefined, now: number): number {
  return at && Number.isFinite(at) ? Math.max(0, now - at) / 60000 : 0;
}

function trainFreshUntil(row: SceneTrain, snapshot: Scene): number {
  const at = snapshotTime(row.snapshot_at == null ? undefined : row.snapshot_at * 1000, snapshot.cached_at) ?? 0;
  if (row.movement === "stopped") return at + Math.max(0, STOPPED_REPORT_MAX_AGE_MIN - row.age_min) * 60000;
  return at + (row.motion?.valid_for_sec == null ? ESTIMATE_WINDOW_MS : row.motion.valid_for_sec * 1000);
}

function minutesSince(at: number | undefined, now: number, validMs = ESTIMATE_WINDOW_MS): number {
  if (!at || !Number.isFinite(at)) return 0;
  const elapsed = Math.max(0, now - at);
  return elapsed <= validMs ? elapsed / 60000 : 0;
}

export function sceneFreshUntil(snapshot: Scene): number {
  if (!snapshot.trains.length) return (snapshot.cached_at ?? 0) + ESTIMATE_WINDOW_MS;
  return Math.max(...snapshot.trains.map((row) => trainFreshUntil(row, snapshot)));
}

function statusAt(status: string, closesIn: number | undefined): string {
  return status === "closing_soon" && closesIn != null && closesIn <= 0 ? "closed" : status;
}

export function currentPrediction(snapshot: Predict | null, now: number): Predict | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const at = snapshotTime(snapshot.generated_at ? Date.parse(snapshot.generated_at) : undefined, snapshot.cached_at);
  const elapsed = minutesSince(at, now);
  const ageElapsed = elapsedMinutes(at, now);
  const stopped = new Set(snapshot.approaching.filter((row) => row.at_station || row.run === "at").map((row) => row.train));
  const awaiting = [...(snapshot.awaiting_update ?? [])];
  const staleStopped = new Set<string>();
  for (const row of snapshot.approaching) {
    if (!stopped.has(row.train) || (row.age_min ?? 0) + ageElapsed < STOPPED_REPORT_MAX_AGE_MIN) continue;
    staleStopped.add(row.train);
    const held = awaiting.findIndex((train) => train.number === row.train);
    if (held < 0) awaiting.push({ number: row.train, name: row.name,
      current: row.current || "the station", age_min: (row.age_min ?? 0) + ageElapsed,
      reason: "stopped_report", ids: row.ids });
    else awaiting[held] = { ...awaiting[held], ids: [...new Set([...(awaiting[held].ids ?? []), ...(row.ids ?? [])])] };
  }
  const advance = <T extends { train: string; eta: number; closes_in?: number; status: string; at_station?: boolean }>(row: T): T => {
    if (row.at_station || stopped.has(row.train)) return row;
    const closes_in = row.closes_in == null ? undefined : row.closes_in - elapsed;
    return { ...row, eta: row.eta - elapsed, closes_in, status: statusAt(row.status, closes_in) };
  };
  const exact = snapshot.gate_predictions?.filter((row) => !staleStopped.has(row.train)).map(advance).filter((row) => row.eta >= -2);
  const approaching = snapshot.approaching.flatMap((original) => {
    if (staleStopped.has(original.train)) return [];
    const row = advance(original);
    if (exact != null) {
      const gates = exact.filter((gate) => gate.train === row.train && row.ids?.includes(gate.id));
      if (!gates.length) return [];
      const first = gates.reduce((a, b) => a.eta < b.eta ? a : b);
      return [{ ...row, eta: first.eta, closes_in: first.closes_in, status: first.status, ids: gates.map((gate) => gate.id), count: gates.length }];
    }
    return row.eta >= -2 ? [row] : [];
  });
  return { ...snapshot, gate_predictions: exact, approaching, awaiting_update: awaiting };
}

export function currentScene(snapshot: Scene | null, now: number): Scene | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const passed = [...(snapshot.passed ?? [])];
  const awaiting = [...(snapshot.awaiting_update ?? [])];
  const fresh = snapshot.trains.filter((row) => now <= trainFreshUntil(row, snapshot));
  const candidates = snapshot.trains.filter((row) => row.movement === "stopped" || !fresh.length || fresh.includes(row));
  const trains = candidates.flatMap((row) => {
    if (row.movement === "stopped") {
      const age = row.age_min + elapsedMinutes(snapshotTime(row.snapshot_at == null ? undefined : row.snapshot_at * 1000, snapshot.cached_at), now);
      if (age >= STOPPED_REPORT_MAX_AGE_MIN) {
        if (!awaiting.some((train) => train.number === row.number)) awaiting.push({ number: row.number, name: row.name,
          current: row.current || "the station", last_station: row.last_station, age_min: age,
          reason: "stopped_report", ids: snapshot.crossing ? [snapshot.crossing.id] : undefined });
        return [];
      }
      return [row];
    }
    const elapsed = minutesSince(snapshotTime(row.snapshot_at == null ? undefined : row.snapshot_at * 1000, snapshot.cached_at), now,
      row.motion == null ? ESTIMATE_WINDOW_MS : row.motion.valid_for_sec * 1000);
    const eta_min = row.eta_min - elapsed;
    if (eta_min < -2) {
      passed.push({ number: row.number, name: row.name, ago_min: -eta_min });
      return [];
    }
    const closes_in_min = row.closes_in_min == null ? undefined : row.closes_in_min - elapsed;
    return [{ ...row, eta_min, closes_in_min, status: statusAt(row.status, closes_in_min) }];
  });
  return { ...snapshot, trains, awaiting_update: awaiting,
    passed: passed.filter((row) => !awaiting.some((train) => train.number === row.number)).sort((a, b) => a.ago_min - b.ago_min) };
}
