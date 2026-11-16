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
