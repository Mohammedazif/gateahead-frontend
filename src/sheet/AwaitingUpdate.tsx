import type { AwaitingTrain } from "../api";

export function AwaitingUpdate({ trains }: { trains?: AwaitingTrain[] }) {
  if (!trains?.length) return null;
  return <section className="gate-status" role="status" aria-label="Position update needed">
    <h3>Position update needed</h3>
    {trains.map((train) => <div key={train.number}>
      <p>{train.number} {train.name}</p>
      <p className="quiet">Last reported stopped at {train.current} · report {Math.round(train.age_min)} min old at check</p>
    </div>)}
    <p className="quiet">Passage has not been confirmed. The barrier’s position is unknown.</p>
  </section>;
}
