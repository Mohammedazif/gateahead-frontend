import type { SceneTrain } from "./api";

// What a person at a crossing reads. The phone app and the Telegram bot use the same wording.

/**
 * When the barrier comes down, or that it is down.
 * `eta` is minutes until the train reaches the crossing; `closesIn` is minutes until the barrier
 * comes down (zero or less: down now). An older API without `closesIn` counts down to the train.
 */
export function gateLabel(eta: number, closesIn?: number | null, status?: string): string {
  const downIn = closesIn ?? eta;
  if (status === "approaching" && downIn <= 0) return "train timing uncertain";
  if (downIn <= 0) return eta <= 0 ? "closed · train passing" : eta < 1 ? "closed · train due within 1 min" : `closed · train in ${Math.round(eta)} min`;
  if (downIn < 1) return "closing now";
  return `closes in ${span(downIn)}`;
}

export function estimatedPassingWindow(train: SceneTrain): boolean {
  return train.status === "closed" && train.eta_min <= 0 &&
    (train.movement === "stopped" || (!train.motion && train.position_on_segment !== true));
}

export function sceneTimingLabel(train: SceneTrain, historical: boolean): string {
  const closure = train.closes_in_min ?? train.eta_min;
  if (train.observed === false) {
    const arrival = train.eta_min > 0 ? span(Math.max(1, train.eta_min)) : null;
    return historical
      ? arrival ? `At saved check, the timetable estimated arrival ${arrival} later` : "At saved check, train timing came from the timetable"
      : arrival ? `Timetable estimate · train due in ${arrival}` : "Timetable estimate · position unknown";
  }
  if (historical) {
    if (estimatedPassingWindow(train)) return "At saved check, the train was estimated to be in the passing window";
    if (train.status === "approaching" && closure <= 0) return "Train timing was uncertain at the saved check";
    if (closure <= 0) return "The barrier was estimated closed at the saved check";
    if (closure < 1) return "Closure was estimated to be imminent at the saved check";
    return `At saved check, the barrier was estimated to close ${span(closure)} later`;
  }
  if (estimatedPassingWindow(train)) return "Estimated passing window";
  return gateLabel(train.eta_min, train.closes_in_min, train.status);
}

export function passedLabel(ago: number): string {
  if (ago < 1) return "passed just now";
  return `passed ${Math.round(ago)} min ago`;
}

export function labelStatus(status: string): string {
  if (status === "closed") return "Closed";
  if (status === "closing_soon") return "Closing";
  if (status === "approaching") return "Approaching";
  if (status === "later") return "Later";
  if (status === "passed") return "Passed";
  return status;
}

function span(minutes: number): string {
  if (minutes >= 60) {
    let hours = Math.floor(minutes / 60);
    let mins = Math.round(minutes - hours * 60);
    if (mins === 60) {
      hours += 1;
      mins = 0;
    }
    return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
  }
  return `${Math.round(minutes)} min`;
}
