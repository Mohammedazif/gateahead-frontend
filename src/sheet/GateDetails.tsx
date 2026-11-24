import { useEffect, useState } from "react";
import { OperatingUpdates } from "./OperatingUpdates";
import { runKey, runDateLabel } from "../runIdentity";
import { fetchCrossingDetails, isLegacyCrossingId, type CrossingDetails, type Gate, type Scene } from "../api";
import { incompleteCheck } from "../features";
import { estimatedPassingWindow, passedLabel, sceneTimingLabel } from "../labels";
import { GateActions } from "./FeatureControls";
import { Icon } from "../ui/Icon";
import { CoverageNotice } from "./CoverageNotice";
import { AwaitingUpdate } from "./AwaitingUpdate";
import { CrossingAccess } from "./CrossingAccess";

export function GateDetails({ gate, scene, loading, message, historical, focusedTrain, visibleTrains, onFocusTrain, saved, onSave, onBack, track, verifiedGate = false }: {
  gate: Gate; scene: Scene | null; loading: boolean; message: string | null; historical: boolean;
  focusedTrain: string | null; visibleTrains: Set<string>; onFocusTrain: (number: string) => void;
  saved: boolean; onSave: () => void; onBack: () => void; track?: string; verifiedGate?: boolean;
}) {
  const lead = scene?.trains.reduce<Scene["trains"][number] | undefined>((first, row) => !first || row.eta_min < first.eta_min ? row : first, undefined);
  const gone = scene?.passed?.[0];
  const awaiting = scene?.awaiting_update ?? [];
  const incomplete = incompleteCheck(scene);
  const name = scene?.crossing?.name || gate.name || "Level crossing";
  const details = [gate.road && !name.includes(gate.road) ? gate.road : "", track].filter(Boolean).join(" · ");
  const [accessCheck, setAccessCheck] = useState<{ requested: string; body: CrossingDetails } | null>(null);
  const { id, lat, lon } = gate;
  useEffect(() => {
    const request = new AbortController();
    void fetchCrossingDetails(gate, request.signal).then((body) => {
      if (!request.signal.aborted) setAccessCheck({ requested: id, body });
    }).catch(() => { /* The scene can still supply access on an older server. */ });
    return () => request.abort();
  }, [id, lat, lon]); // A marked gate's train timing changes without changing its identity.
  const independent = accessCheck && (accessCheck.requested === id || accessCheck.body.crossing?.id === id)
    ? accessCheck.body : null;
  const independentIsCurrent = independent?.crossing_access && !independent.offline && !independent.map_warning;
  const sceneIsCurrent = scene?.crossing_access && !scene.offline && !scene.map_warning;
  const accessSource = independent?.error === "crossing_not_found" || scene?.error === "crossing_not_found" ? null
    : independentIsCurrent || (!sceneIsCurrent && independent?.crossing_access) ? independent : scene;
  const accessGate = accessSource?.crossing ? { ...gate, ...accessSource.crossing } : gate;
  const canUseGate = verifiedGate || Boolean(scene?.available && !scene.offline && !scene.map_warning);
  const canFlagAccess = !isLegacyCrossingId(accessGate.id) && Boolean(accessSource?.crossing && !accessSource.offline && !accessSource.map_warning);
  return <section className="gate-detail" aria-label="Crossing details">
    <button type="button" className="back-link" onClick={onBack}><Icon name="back" size={18} />Back to crossings</button>
    <div className="detail-heading"><p className="eyebrow">Selected crossing</p><h2>{name}</h2><p className="quiet">{gate.km.toFixed(1)} km from your search point</p>{details && <p className="quiet">{details}</p>}</div>
    {loading ? <p className="quiet" role="status">Checking this crossing…</p> : <>
      {message && <p className="notice" role="status">{message}</p>}
      {historical && <p className="notice">Saved view · {scene?.cached_at ? new Date(scene.cached_at).toLocaleString() : "last check"}. Timings describe that check.</p>}
      <CoverageNotice coverage={scene?.coverage} map_warning={scene?.map_warning} map_age_seconds={scene?.map_age_seconds} />
      <AwaitingUpdate trains={awaiting} /><OperatingUpdates updates={scene?.service_updates} />
      {lead ? <div className={`gate-status ${lead.status}`}>
        <p className="eyebrow">{historical ? "At last check · estimate" : awaiting.length ? "Other reported train · estimate" : gone ? "Next approaching train · estimate" : "Estimated barrier timing"}</p>
        <h3>{sceneTimingLabel(lead, historical)}</h3>
        <p>{lead.number} {lead.name} {runDateLabel(lead)}</p>
        {lead.movement === "stopped" && lead.observed !== false && <p className="quiet">The train was reported stopped. Movement will appear when a moving report is available.</p>}
        {!historical && lead.eta_min > 0 && <p className="quiet">Estimated train arrival {lead.eta_min < 1 ? "within 1 min" : `in ${Math.round(lead.eta_min)} min`}</p>}
        <p className="quiet">{lead.observed === false ? "Timetable estimate · current position unavailable"
          : `${lead.basis === "timetable" ? "Timetable estimate from a train report" : "Train report"} · ${Math.round(lead.age_min)} min old at check`}</p>
        {estimatedPassingWindow(lead) && <p className="quiet">The train’s passage is unconfirmed.</p>}
        {lead.bracket && <details className="disclosure"><summary>About this estimate</summary><p className="quiet">{lead.bracket}</p></details>}
      </div> : scene?.available && !awaiting.length ? <div className="gate-status"><h3>{incomplete ? "The latest check did not establish train timing" : "No approaching train in the latest check"}</h3><p className="quiet">The barrier’s position is unknown.</p></div> : null}
      {gone && <p className="quiet">Recently passed (estimated) · {gone.number} {gone.name} {runDateLabel(gone)} · {passedLabel(gone.ago_min)}</p>}
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
    {!loading && scene?.error !== "crossing_not_found" && !isLegacyCrossingId(gate.id) &&
      <GateActions key={gate.id} gate={gate} saved={saved} onSave={onSave} canUseGate={canUseGate} />}
    {accessSource?.crossing_access && <CrossingAccess key={`access-${accessGate.id}`} access={accessSource.crossing_access} gate={accessGate}
      canFlag={canFlagAccess} saved={Boolean(accessSource.offline || accessSource.map_warning)} />}
    {scene && <CrossingTimeline scene={scene} historical={historical} focusedTrain={focusedTrain} visibleTrains={visibleTrains} onFocusTrain={onFocusTrain} />}
  </section>;
}

function CrossingTimeline({ scene, historical, focusedTrain, visibleTrains, onFocusTrain }: { scene: Scene; historical: boolean; focusedTrain: string | null; visibleTrains: Set<string>; onFocusTrain: (number: string) => void }) {
  const rows = [...scene.trains].sort((a, b) => a.eta_min - b.eta_min);
  if (rows.length < 2) return null;
  return <section className="crossing-timeline">
    <p className="eyebrow">{historical ? "Trains at this saved check" : scene.awaiting_update?.length ? "Other reported trains at this crossing" : "Next trains at this crossing"}</p>
    <ol>{rows.map((row) => <li key={runKey(row)}><strong>{row.number} {row.name} {runDateLabel(row)}</strong><span>{historical
      ? sceneTimingLabel(row, true) : row.eta_min <= 0 ? "Estimated passing window" : `Train arrival in about ${Math.round(row.eta_min)} min`}</span>{visibleTrains.has(runKey(row)) && <button type="button" className="text-button" aria-pressed={focusedTrain === runKey(row)} onClick={() => onFocusTrain(runKey(row))}>Show on map</button>}</li>)}</ol>
    <p className="quiet">Uses the same crossing check as the timing above. Reopening time is unknown.</p>
  </section>;
}
