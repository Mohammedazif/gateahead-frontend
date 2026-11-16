import type { Gate, Scene } from "../api";
import { gateLabel, passedLabel } from "../labels";
import { GateActions } from "./FeatureControls";
import { Icon } from "../ui/Icon";

export function GateDetails({ gate, scene, loading, message, historical, saved, onSave, onBack }: {
  gate: Gate; scene: Scene | null; loading: boolean; message: string | null; historical: boolean;
  saved: boolean; onSave: () => void; onBack: () => void;
}) {
  const lead = scene?.trains[0];
  const gone = scene?.passed?.[0];
  return <section className="gate-detail" aria-label="Crossing details">
    <button type="button" className="back-link" onClick={onBack}><Icon name="back" size={18} />Back to crossings</button>
    <div className="detail-heading"><p className="eyebrow">Selected crossing</p><h2>{scene?.crossing?.name || gate.name || "Level crossing"}</h2><p className="quiet">{gate.km.toFixed(1)} km from your search point</p></div>
    {loading ? <p className="quiet" role="status">Checking this crossing…</p> : message ? <p className="notice">{message}</p> : <>
      {historical && <p className="notice">Saved view · {scene?.cached_at ? new Date(scene.cached_at).toLocaleString() : "last check"}. Timings describe that check.</p>}
      {lead ? <div className={`gate-status ${lead.status}`}>
        <p className="eyebrow">{historical ? "At last check · estimate" : gone ? "Next approaching train · estimate" : "Estimated barrier timing"}</p>
        <h3>{lead.status === "closed" && lead.eta_min <= 0 && !lead.motion && lead.position_on_segment !== true ? "Estimated passing window" : gateLabel(lead.eta_min, lead.closes_in_min, lead.status)}</h3>
        <p>{lead.number} {lead.name}</p>
        {lead.movement === "stopped" && <p className="quiet">The train was reported stopped. Movement will appear when a moving report is available.</p>}
        {lead.eta_min > 0 && <p className="quiet">Estimated train arrival {lead.eta_min < 1 ? "within 1 min" : `in ${Math.round(lead.eta_min)} min`}</p>}
        <p className="quiet">{lead.basis === "timetable" ? "Timetable estimate" : "Train report"} · {Math.round(lead.age_min)} min old at check</p>
        {lead.status === "closed" && lead.eta_min <= 0 && !lead.motion && lead.position_on_segment !== true && <p className="quiet">The timing is estimated; the reported position is unavailable in this view.</p>}
        {lead.bracket && <details className="disclosure"><summary>About this estimate</summary><p className="quiet">{lead.bracket}</p></details>}
      </div> : scene ? <div className="gate-status"><h3>No approaching train in the latest check</h3><p className="quiet">The barrier’s position is unknown.</p></div> : null}
      {gone && <p className="quiet">Recently passed (estimated): {gone.number} {gone.name} · {passedLabel(gone.ago_min)}</p>}
    </>}
    <GateActions key={gate.id} gate={gate} saved={saved} onSave={onSave} />
    {scene && <CrossingTimeline scene={scene} historical={historical} />}
  </section>;
}

function CrossingTimeline({ scene, historical }: { scene: Scene; historical: boolean }) {
  const rows = [...scene.trains].sort((a, b) => a.eta_min - b.eta_min);
  if (rows.length < 2) return null;
  return <section className="crossing-timeline">
    <p className="eyebrow">{historical ? "Trains at this saved check" : "Next trains at this crossing"}</p>
    <ol>{rows.map((row) => <li key={row.number}><strong>{row.number} {row.name}</strong><span>{row.eta_min <= 0 ? "Estimated to be passing" : `Train arrival in about ${Math.round(row.eta_min)} min`}</span></li>)}</ol>
    <p className="quiet">Uses the same crossing check as the timing above. Reopening time is unknown.</p>
  </section>;
}
