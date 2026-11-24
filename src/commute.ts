import { fetchScene, friendlyError, RequestError, savedScenes, type Scene } from "./api";
import { incompleteCheck, readStored, type SavedGate } from "./features";

export const MAX_COMMUTES = 12;
export const MAX_COMMUTE_GATES = 6;
export const COMMUTE_COOLDOWN_MS = 90000;

export type Commute = { id: string; label: string; gateIds: string[] };
export type CommuteResult = { scene: Scene | null; error?: string; invalidated?: boolean };

export function readCommutes(): Commute[] {
  const raw = readStored<Partial<Commute>[]>("commutes", []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const commutes: Commute[] = [];
  for (const row of raw) {
    if (typeof row?.id !== "string" || !row.id || seen.has(row.id) ||
        typeof row.label !== "string" || !row.label.trim() || !Array.isArray(row.gateIds)) continue;
    const gateIds = [...new Set(row.gateIds.filter((id): id is string => typeof id === "string" && Boolean(id)))].slice(0, MAX_COMMUTE_GATES);
    if (!gateIds.length) continue;
    seen.add(row.id);
    commutes.push({ id: row.id, label: row.label.trim().slice(0, 80), gateIds });
    if (commutes.length === MAX_COMMUTES) break;
  }
  return commutes;
}

function checkPoint(item: SavedGate) {
  return item.place.privateLocation ? item.gate : item.place;
}

export function readCommuteResults(commutes: Commute[], favorites: SavedGate[]): Record<string, CommuteResult> {
  const saved = new Set(favorites.map((item) => item.gate.id));
  const ids = new Set(commutes.flatMap((commute) => commute.gateIds).filter((id) => saved.has(id)));
  return Object.fromEntries([...savedScenes(ids)].map(([id, scene]) => [id, { scene }]));
}

export function mergeCommuteResult(previous: CommuteResult | undefined, result: CommuteResult): CommuteResult {
  const prior = previous?.scene;
  if (!prior?.available || result.invalidated) return result;
  const next = result.scene;
  if (next?.available && (next.trains.length || !incompleteCheck(next))) return result;
  return { scene: { ...prior, offline: true },
    error: result.error ?? "The latest check did not establish train timing." };
}

export async function checkCommuteGates(items: SavedGate[], signal: AbortSignal,
  onResult: (id: string, result: CommuteResult) => void, onPause: (retryAt: number) => void) {
  const queue = [...items];
  let paused = false;
  async function checkNext() {
    while (!signal.aborted && !paused) {
      const item = queue.shift();
      if (!item) return;
      const { gate } = item;
      const point = checkPoint(item);
      try {
        const scene = await fetchScene(point.lat, point.lon, gate.id, signal);
        if (signal.aborted) return;
        onResult(gate.id, scene.error
          ? { scene: null, error: friendlyError(scene.error), invalidated: scene.error === "crossing_not_found" }
          : { scene });
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RequestError && err.retryAt) {
          paused = true;
          onPause(err.retryAt);
        }
        onResult(gate.id, { scene: null, error: err instanceof Error ? err.message : "Could not check this crossing." });
      }
    }
  }
  await Promise.all([checkNext(), checkNext()]);
  if (!signal.aborted && paused) {
    for (const item of queue) onResult(item.gate.id, { scene: null, error: "Checks are paused. Try again in a few minutes." });
  }
}
