import type { ServiceUpdate } from "../api";
import { runDateLabel, runKey } from "../runIdentity";

export function OperatingUpdates({ updates }: { updates?: ServiceUpdate[] }) {
  if (!updates?.length) return null;
  return <section aria-label="Train operating updates">{updates.map((row) => <p className="notice" key={runKey(row)}>
    {row.number}{row.start_date && ` · ${runDateLabel(row)}`} · {row.status === "cancelled" ? "Cancelled" : row.status === "diverted" ? "Diverted" : "Partially cancelled"}
    {row.status !== "cancelled" && " · Crossing timing is unavailable until this journey’s route is confirmed."}
  </p>)}</section>;
}
