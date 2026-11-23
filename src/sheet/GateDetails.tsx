import { OperatingUpdates } from "./OperatingUpdates";
import { runKey, runDateLabel } from "../runIdentity";
import type { Gate, Scene } from "../api";
import { gateLabel, passedLabel } from "../labels";
import { GateActions } from "./FeatureControls";
import { Icon } from "../ui/Icon";
import { CoverageNotice } from "./CoverageNotice";
import { AwaitingUpdate } from "./AwaitingUpdate";

export function GateDetails({ gate, scene, loading, message, historical, focusedTrain, visibleTrains, onFocusTrain, saved, onSave, onBack, track }: {
  gate: Gate; scene: Scene | null; loading: boolean; message: string | null; historical: boolean;
  focusedTrain: string | null; visibleTrains: Set<string>; onFocusTrain: (number: string) => void;
  saved: boolean; onSave: () => void; onBack: () => void; track?: string;
}) {
  const lead = scene?.trains[0];
  const gone = scene?.passed?.[0];
  const awaiting = scene?.awaiting_update ?? [];
  const name = scene?.crossing?.name || gate.name || "Level crossing";
  const details = [gate.road && !name.includes(gate.road) ? gate.road : "", track].filter(Boolean).join(" · ");
  return <section className="gate-detail" aria-label="Crossing details">
    <button type="button" className="back-link" onClick={onBack}><Icon name="back" size={18} />Back to crossings</button>
    <div className="detail-heading"><p className="eyebrow">Selected crossing</p><h2>{name}</h2><p className="quiet">{gate.km.toFixed(1)} km from your search point</p>{details && <p className="quiet">{details}</p>}</div>
    {loading ? <p className="quiet" role="status">Checking this crossing…</p> : message ? <p className="notice">{message}</p> : <>
      {historical && <p className="notice">Saved view · {scene?.cached_at ? new Date(scene.cached_at).toLocaleString() : "last check"}. Timings describe that check.</p>}
      <CoverageNotice coverage={scene?.coverage} />
      <AwaitingUpdate trains={awaiting} /><OperatingUpdates updates={scene?.service_updates} />
      {lead ? <div className={`gate-status ${lead.status}`}>
        <p className="eyebrow">{historical ? "At last check · estimate" : awaiting.length ? "Other reported train · estimate" : gone ? "Next approaching train · estimate" : "Estimated barrier timing"}</p>
        <h3>{lead.status === "closed" && lead.eta_min <= 0 && !lead.motion && lead.position_on_segment !== true ? "Estimated passing window" : gateLabel(lead.eta_min, lead.closes_in_min, lead.status)}</h3>
        <p>{lead.number} {lead.name} {runDateLabel(lead)}</p>
        {lead.movement === "stopped" && <p className="quiet">The train was reported stopped. Movement will appear when a moving report is available.</p>}
        {lead.eta_min > 0 && <p className="quiet">Estimated train arrival {lead.eta_min < 1 ? "within 1 min" : `in ${Math.round(lead.eta_min)} min`}</p>}
        <p className="quiet">{lead.basis === "timetable" ? "Timetable estimate" : "Train report"} · {Math.round(lead.age_min)} min old at check</p>
        {lead.status === "closed" && lead.eta_min <= 0 && !lead.motion && lead.position_on_segment !== true && <p className="quiet">The timing is estimated; the reported position is unavailable in this view.</p>}
        {lead.bracket && <details className="disclosure"><summary>About this estimate</summary><p className="quiet">{lead.bracket}</p></details>}
      </div> : scene && !awaiting.length ? <div className="gate-status"><h3>No approaching train in the latest check</h3><p className="quiet">The barrier’s position is unknown.</p></div> : null}
      {gone && <p className="quiet">Recently passed (estimated): {gone.number} {gone.name} {runDateLabel(gone)} · {passedLabel(gone.ago_min)}</p>}
    </>}
    {visibleTrains.size > 0 && <section className="trains-on-map" aria-label="Trains on map">
      <p className="eyebrow">{visibleTrains.size} {visibleTrains.size === 1 ? "train" : "trains"} on map</p>
      <div className="train-focus-list">{scene?.trains.filter((train) => visibleTrains.has(runKey(train))).map((train) =>
        <button key={runKey(train)} type="button" className="ghost" aria-pressed={focusedTrain === runKey(train)}
          onClick={() => onFocusTrain(runKey(train))} title={`${train.number} ${train.name} ${runDateLabel(train)}`}>
          {train.number}<span className="quiet">{train.start_date && `${train.start_date} · `}{train.eta_min <= 0 ? "passing" : `in ${Math.max(1, Math.round(train.eta_min))} min`}</span>
        </button>)}</div>
      <p className="quiet">Positions and track assignments are estimated. Choose a train to locate it.</p>
    </section>}
    <GateActions key={gate.id} gate={gate} saved={saved} onSave={onSave} />
    {scene && <CrossingTimeline scene={scene} historical={historical} focusedTrain={focusedTrain} visibleTrains={visibleTrains} onFocusTrain={onFocusTrain} />}
  </section>;
}

function CrossingTimeline({ scene, historical, focusedTrain, visibleTrains, onFocusTrain }: { scene: Scene; historical: boolean; focusedTrain: string | null; visibleTrains: Set<string>; onFocusTrain: (number: string) => void }) {
  const rows = [...scene.trains].sort((a, b) => a.eta_min - b.eta_min);
  if (rows.length < 2) return null;
  return <section className="crossing-timeline">
    <p className="eyebrow">{historical ? "Trains at this saved check" : scene.awaiting_update?.length ? "Other reported trains at this crossing" : "Next trains at this crossing"}</p>
    <ol>{rows.map((row) => <li key={runKey(row)}><strong>{row.number} {row.name} {runDateLabel(row)}</strong><span>{row.eta_min <= 0 ? "Estimated to be passing" : `Train arrival in about ${Math.round(row.eta_min)} min`}</span>{visibleTrains.has(runKey(row)) && <button type="button" className="text-button" aria-pressed={focusedTrain === runKey(row)} onClick={() => onFocusTrain(runKey(row))}>Show on map</button>}</li>)}</ol>
    <p className="quiet">Uses the same crossing check as the timing above. Reopening time is unknown.</p>
  </section>;
}
