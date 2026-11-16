import type { Predict, Scene } from "./api";

// Advance only between normal checks; saved/offline results keep their original timings.
export const ESTIMATE_WINDOW_MS = 120000;

function minutesSince(at: number | undefined, now: number, validMs = ESTIMATE_WINDOW_MS): number {
  if (!at || !Number.isFinite(at)) return 0;
  const elapsed = Math.max(0, now - at);
  return elapsed <= validMs ? elapsed / 60000 : 0;
}

export function sceneFreshUntil(snapshot: Scene): number {
  const lead = snapshot.trains[0];
  const at = lead?.snapshot_at == null ? snapshot.cached_at ?? 0 : lead.snapshot_at * 1000;
  return at + (lead?.motion?.valid_for_sec == null ? ESTIMATE_WINDOW_MS : lead.motion.valid_for_sec * 1000);
}

function statusAt(status: string, closesIn: number | undefined): string {
  return status === "closing_soon" && closesIn != null && closesIn <= 0 ? "closed" : status;
}

export function currentPrediction(snapshot: Predict | null, now: number): Predict | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const elapsed = minutesSince(snapshot.generated_at ? Date.parse(snapshot.generated_at) : snapshot.cached_at, now);
  if (!elapsed) return snapshot;
  const advance = <T extends { eta: number; closes_in?: number; status: string }>(row: T): T => {
    const closes_in = row.closes_in == null ? undefined : row.closes_in - elapsed;
    return { ...row, eta: row.eta - elapsed, closes_in, status: statusAt(row.status, closes_in) };
  };
  const exact = snapshot.gate_predictions?.map(advance).filter((row) => row.eta >= -2);
  const approaching = snapshot.approaching.flatMap((original) => {
    const row = advance(original);
    if (exact != null) {
      const gates = exact.filter((gate) => gate.train === row.train && row.ids?.includes(gate.id));
      if (!gates.length) return [];
      const first = gates.reduce((a, b) => a.eta < b.eta ? a : b);
      return [{ ...row, eta: first.eta, closes_in: first.closes_in, status: first.status, ids: gates.map((gate) => gate.id), count: gates.length }];
    }
    return row.eta >= -2 ? [row] : [];
  });
  return { ...snapshot, gate_predictions: exact, approaching };
}

export function currentScene(snapshot: Scene | null, now: number): Scene | null {
  if (!snapshot || snapshot.offline) return snapshot;
  const passed = [...(snapshot.passed ?? [])];
  const trains = snapshot.trains.flatMap((row) => {
    const elapsed = minutesSince(row.snapshot_at == null ? snapshot.cached_at : row.snapshot_at * 1000, now,
      row.motion == null ? ESTIMATE_WINDOW_MS : row.motion.valid_for_sec * 1000);
    const eta_min = row.eta_min - elapsed;
    if (eta_min < -2) {
      passed.push({ number: row.number, name: row.name, ago_min: -eta_min });
      return [];
    }
    const closes_in_min = row.closes_in_min == null ? undefined : row.closes_in_min - elapsed;
    return [{ ...row, eta_min, closes_in_min, status: statusAt(row.status, closes_in_min) }];
  });
  return { ...snapshot, trains, passed: passed.sort((a, b) => a.ago_min - b.ago_min) };
}
