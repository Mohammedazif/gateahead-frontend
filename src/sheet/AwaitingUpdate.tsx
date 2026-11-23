import { runKey, runDateLabel } from "../runIdentity";
import type { AwaitingTrain } from "../api";

function reportSummary(train: AwaitingTrain): string {
  if (train.reason === "unknown_report_age") return "The source did not confirm when this position was reported.";
  if (train.reason === "estimate_elapsed") return "The earlier estimate expired. A new report is needed.";
  if (train.reason === "stopped_report") return `Last reported stopped${train.current ? ` at ${train.current}` : ""} · report ${Math.round(train.age_min)} min old`;
  return `Last known position${train.current ? ` near ${train.current}` : ""} · report ${Math.round(train.age_min)} min old`;
}

export function AwaitingUpdate({ trains }: { trains?: AwaitingTrain[] }) {
  if (!trains?.length) return null;
  return <section className="gate-status" role="status" aria-label="Position update needed">
    <h3>Position update needed</h3>
    {trains.map((train) => <div key={runKey(train)}>
      <p>{train.number} {train.name} {runDateLabel(train)}</p>
      <p className="quiet">{reportSummary(train)}</p>
    </div>)}
    <p className="quiet">Passage has not been confirmed. The barrier’s position is unknown.</p>
  </section>;
}
