import { runKey } from "./runIdentity";
import type { AwaitingTrain, Predict, Scene, SceneTrain } from "./api";
import { snapshotTime } from "./snapshotClock";

// Advance only between normal checks; saved/offline results keep their original timings.
export const ESTIMATE_WINDOW_MS = 120000;
export const REPORT_MAX_AGE_MIN = 8;

function elapsedMinutes(at: number | undefined, now: number): number {
  return at && Number.isFinite(at) ? Math.max(0, now - at) / 60000 : 0;
}

function sceneRowTime(row: SceneTrain, snapshot: Scene): number | undefined {
  return snapshotTime(row.snapshot_at == null ? undefined : row.snapshot_at * 1000, snapshot.cached_at);
}

function sceneRowValidity(row: SceneTrain): number {
  if (row.observed === false) return ESTIMATE_WINDOW_MS;
  const remaining = Math.max(0, REPORT_MAX_AGE_MIN - row.age_min) * 60000;
  if (row.movement === "stopped") return remaining;
  return Math.min(remaining, row.motion == null ? ESTIMATE_WINDOW_MS : row.motion.valid_for_sec * 1000);
}

function minutesSince(at: number | undefined, now: number, validMs = ESTIMATE_WINDOW_MS): number {
  if (!at || !Number.isFinite(at)) return 0;
  const elapsed = Math.max(0, now - at);
  return elapsed <= validMs ? elapsed / 60000 : 0;
}

export function sceneFreshUntil(snapshot: Scene): number {
  if (!snapshot.trains.length) return (snapshot.cached_at ?? 0) + ESTIMATE_WINDOW_MS;
  return Math.max(...snapshot.trains.map((row) => (sceneRowTime(row, snapshot) ?? 0) + sceneRowValidity(row)));
}

function statusAt(status: string, closesIn: number | undefined): string {
  return status === "closing_soon" && closesIn != null && closesIn <= 0 ? "closed" : status;
}

export function currentPrediction(snapshot: Predict | null, now: number): Predict | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const at = snapshotTime(snapshot.generated_at ? Date.parse(snapshot.generated_at) : undefined, snapshot.cached_at);
  const elapsed = minutesSince(at, now);
  const ageElapsed = elapsedMinutes(at, now);
  const stopped = new Set(snapshot.approaching.filter((row) => row.at_station || row.run === "at").map(runKey));
  const awaiting = [...(snapshot.awaiting_update ?? [])];
  const recordAwaiting = (row: AwaitingTrain) => {
    const held = awaiting.findIndex((train) => runKey(train) === runKey(row));
    if (held < 0) awaiting.push(row);
    else awaiting[held] = { ...awaiting[held], ids: [...new Set([...(awaiting[held].ids ?? []), ...(row.ids ?? [])])] };
  };
  const stale = new Set<string>();
  for (const row of snapshot.approaching) {
    if (row.observed === false || row.age_min == null || row.age_min + ageElapsed < REPORT_MAX_AGE_MIN) continue;
    stale.add(runKey(row));
    recordAwaiting({ number: row.train, run_id: row.run_id, start_date: row.start_date, name: row.name,
      current: row.current || "", age_min: row.age_min + ageElapsed,
      reason: stopped.has(runKey(row)) ? "stopped_report" : "stale_report", ids: row.ids });
  }
  const advance = <T extends { train: string; eta: number; closes_in?: number; status: string; at_station?: boolean; run_id?: string; start_date?: string }>(row: T): T => {
    if (row.at_station || stopped.has(runKey(row))) return row;
    const closes_in = row.closes_in == null ? undefined : row.closes_in - elapsed;
    return { ...row, eta: row.eta - elapsed, closes_in, status: statusAt(row.status, closes_in) };
  };
  const elapsedEstimate = (row: { train: string; name: string; run_id?: string; start_date?: string; age_min?: number }, ids?: string[]) =>
    recordAwaiting({ number: row.train, run_id: row.run_id, start_date: row.start_date, name: row.name, current: "",
      age_min: (row.age_min ?? 0) + ageElapsed, reason: "estimate_elapsed", ids });
  const exact = snapshot.gate_predictions?.filter((row) => !stale.has(runKey(row))).map(advance).filter((row) => {
    if (row.eta >= -2) return true;
    elapsedEstimate(row, [row.id]);
    return false;
  });
  const approaching = snapshot.approaching.flatMap((original) => {
    if (stale.has(runKey(original))) return [];
    const row = advance(original);
    if (exact != null) {
      const gates = exact.filter((gate) => runKey(gate) === runKey(row) && row.ids?.includes(gate.id));
      if (!gates.length) return [];
      const first = gates.reduce((a, b) => a.eta < b.eta ? a : b);
      return [{ ...row, eta: first.eta, closes_in: first.closes_in, status: first.status, ids: gates.map((gate) => gate.id), count: gates.length }];
    }
    if (row.eta >= -2) return [row];
    elapsedEstimate(row, row.ids);
    return [];
  });
  return { ...snapshot, gate_predictions: exact, approaching, awaiting_update: awaiting };
}

export function currentScene(snapshot: Scene | null, now: number): Scene | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const passed = [...(snapshot.passed ?? [])];
  const awaiting = [...(snapshot.awaiting_update ?? [])];
  const trains = snapshot.trains.flatMap((row) => {
    const at = sceneRowTime(row, snapshot);
    const elapsed = elapsedMinutes(at, now);
    const age = row.age_min + elapsed;
    const unresolved = (reason: AwaitingTrain["reason"]) => {
      if (!awaiting.some((train) => runKey(train) === runKey(row))) awaiting.push({
        number: row.number, run_id: row.run_id, start_date: row.start_date, name: row.name,
        current: row.current ?? "", last_station: row.last_station, age_min: age, reason,
        ids: snapshot.crossing ? [snapshot.crossing.id] : undefined,
      });
      return [];
    };
    if (row.observed !== false && age >= REPORT_MAX_AGE_MIN) return unresolved(row.movement === "stopped" ? "stopped_report" : "stale_report");
    if (row.movement === "stopped") return [row];
    if (at != null && now >= at + sceneRowValidity(row)) return unresolved(row.motion ? "stale_report" : "estimate_elapsed");
    const eta_min = row.eta_min - elapsed;
    if (eta_min < -2) return unresolved("estimate_elapsed");
    const closes_in_min = row.closes_in_min == null ? undefined : row.closes_in_min - elapsed;
    return [{ ...row, eta_min, closes_in_min, status: statusAt(row.status, closes_in_min) }];
  });
  return { ...snapshot, trains, awaiting_update: awaiting, active_at_check: snapshot.trains.filter((row) => row.observed !== false).map(runKey),
    passed: passed.filter((row) => !awaiting.some((train) => runKey(train) === runKey(row))).sort((a, b) => a.ago_min - b.ago_min) };
}
