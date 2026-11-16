import { OperatingUpdates } from "./OperatingUpdates";
import { runKey, runDateLabel } from "../runIdentity";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Approach, Gate, Predict, Scene } from "../api";
import { friendlyError } from "../api";
import { gateLabel, labelStatus, passedLabel } from "../labels";
import { groupCheckLabel, gateCheckLabel, groupGates, groupCrossingTimings, type CrossingTimingGroup } from "../gateGroups";
import type { Theme } from "../theme";
import { checkedAgo } from "./checked";
import { SavedGates, RefreshControls } from "./FeatureControls";
import { GateDetails } from "./GateDetails";
import { CoverageNotice } from "./CoverageNotice";
import { AwaitingUpdate } from "./AwaitingUpdate";
import { Dialog } from "../ui/Dialog";
import { Icon, type IconName } from "../ui/Icon";
import type { RefreshSettings, SavedGate } from "../features";

type Tab = "nearby" | "trains" | "saved";
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "nearby", label: "Nearby", icon: "pin" },
  { id: "trains", label: "Trains", icon: "train" },
  { id: "saved", label: "Saved", icon: "saved" },
];

function activeGate(gate: Gate): boolean {
  return gate.eta != null || Boolean(gate.groupEstimate) || gate.status === "uncertain";
}

type Props = {
  favorites: SavedGate[];
  onOpenSaved: (item: SavedGate) => void;
  onRenameSaved: (item: SavedGate) => void;
  onRemoveSaved: (id: string) => void;
  refresh: RefreshSettings;
  onRefresh: (value: RefreshSettings) => void;
  paused: boolean;
  historical: boolean;
  gatesCached: boolean;
  place: { lat: number; lon: number } | null;
  gates: Gate[];
  selected: Gate | null;
  scene: Scene | null;
  sceneLoading: boolean;
  sceneMessage: string | null;
  sceneHistorical: boolean;
  focusedTrain: string | null;
  visibleTrains: Set<string>;
  onFocusTrain: (number: string) => void;
  onCloseGate: () => void;
  onSaveGate: (gate: Gate) => void;
  gateCount: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
  note: string | null;
  predict: Predict | null;
  checkedAt: number | null;
  theme: Theme;
  placeLabel: string | null;
  onCheck: () => void;
  onTheme: () => void;
  onSelect: (gate: Gate) => void;
};

export function TrainSheet(props: Props) {
  const { place, gates, selected, loading, busy, error, note, predict, checkedAt, theme,
    favorites, refresh, historical, gatesCached, onCheck, onSelect } = props;
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("nearby");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (selected) setTab("nearby"); }, [selected?.id]);
  useEffect(() => { setTab("nearby"); }, [place?.lat, place?.lon]);
  const scroll = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [tab, selected?.id, place]);
  const groups = groupGates(gates);
  const activeGroup = (group: typeof groups[number]) => group.members.some(activeGate);
  const ranked = [...groups].sort((a, b) => {
    const hot = Number(!activeGroup(a)) - Number(!activeGroup(b));
    const aEta = Math.min(...a.members.map((gate) => gate.eta ?? Infinity));
    const bEta = Math.min(...b.members.map((gate) => gate.eta ?? Infinity));
    return hot || (Number.isFinite(aEta) && Number.isFinite(bEta) ? aEta - bEta : a.km - b.km);
  });
  const shown = [...ranked.filter(activeGroup), ...ranked.filter((group) => !activeGroup(group)).slice(0, 12)];

  function changeTab(next: Tab) {
    props.onCloseGate();
    setTab(next);
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    changeTab(tabs[next].id);
    nav.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }
  return <>
    <aside className={`sheet${expanded ? " sheet-expanded" : ""}`} aria-label="Crossings and trains">
      <button type="button" className="sheet-resize" aria-label={expanded ? "Show more map" : "Expand crossings and trains"}
        aria-expanded={expanded} aria-controls="train-sheet-content" onClick={() => setExpanded((current) => !current)}>
        <span className="sheet-grip" aria-hidden="true" />
      </button>
      <div className="sheet-head">
        <div className="sheet-title"><div className="brand">
          <img className="brand-mark" src={`/branding/gateahead-mark-${theme}.svg`} width="28" height="34" alt="" />
          <h1>GateAhead</h1>
        </div><button type="button" className="icon-button settings-button" aria-label="Open settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button></div>
        <nav ref={nav} className="sheet-tabs" role="tablist" aria-label="Explore GateAhead">
          {tabs.map((item, index) => <button key={item.id} id={`tab-${item.id}`} type="button" role="tab"
            aria-selected={tab === item.id} aria-controls="train-sheet-content" tabIndex={tab === item.id ? 0 : -1}
            onClick={() => changeTab(item.id)} onKeyDown={(event) => navigateTabs(event, index)}>
            <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === "saved" && favorites.length > 0 && <small>{favorites.length}</small>}
          </button>)}
        </nav>
      </div>
      <div ref={scroll} className="sheet-body" id="train-sheet-content" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {selected ? <GateDetails gate={selected} scene={props.scene} loading={props.sceneLoading} message={props.sceneMessage}
          historical={props.sceneHistorical} focusedTrain={props.focusedTrain} visibleTrains={props.visibleTrains} onFocusTrain={props.onFocusTrain} saved={favorites.some((item) => item.gate.id === selected.id)}
          onSave={() => props.onSaveGate(selected)} onBack={() => { props.onCloseGate(); setTab("nearby"); }} /> : <>
          {tab === "nearby" && <>
            <div className="content-heading"><h2>Nearby crossings</h2>{place && <button type="button" className="text-button" disabled={busy} onClick={() => { setTab("trains"); onCheck(); }}>{busy ? "Checking…" : "Check trains"}</button>}</div>
            <p className="section-caption">{lede(place, loading, note, groups.length, props.placeLabel)}</p>
            {gatesCached && <p className="notice">Saved crossing locations · map tiles need a connection.</p>}
            {note && <p className="notice">{friendlyError(note)}</p>}
            {!place && <div className="empty-state"><Icon name="pin" size={30} /><h3>Start with a place</h3><p>Use the search above the map, share your location, or tap a point on the railway.</p></div>}
            {shown.length > 0 && <div className="gates"><ul>{shown.map((group) => <li key={group.key}>
              <button type="button" className={activeGroup(group) ? "hot crossing-row" : "crossing-row"} onClick={() => { setExpanded(false); onSelect(group.primary); }}>
                <span className="crossing-dot" aria-hidden="true" /><span className="crossing-copy"><strong>{group.name}</strong><small>{group.km.toFixed(1)} km away{groupCheckLabel(group) ? ` · ${groupCheckLabel(group)}` : ""}</small></span><Icon name="chevron" size={16} />
              </button>
              {group.members.length > 1 && <details className="crossing-members"><summary>{group.members.length} track crossings · choose a gate</summary><ul>{group.members.map((gate) => <li key={gate.id}>
                <button type="button" className="crossing-member" onClick={() => { setExpanded(false); onSelect(gate); }}><span>{gate.name} · Gate {gate.id}</span><small>{gate.km.toFixed(1)} km away · {gateCheckLabel(gate)}</small></button>
              </li>)}</ul></details>}
              </li>)}</ul>
              {groups.length > shown.length && <p className="quiet">{groups.length - shown.length} more crossings are marked on the map.</p>}
            </div>}
          </>}
          {tab === "trains" && <>
            <div className="content-heading"><h2>Trains on this stretch</h2><button type="button" className="solid compact" disabled={!place || busy} onClick={onCheck}>{busy ? "Checking…" : "Check trains"}</button></div>
            {checkedAt != null ? !historical && <CheckedAgo at={checkedAt} /> : <p className="section-caption">Check the latest available train reports for this area.</p>}
            {historical && <p className="notice">Saved check · {checkedAt ? new Date(checkedAt).toLocaleString() : "last result"}. Timings may have changed.</p>}
            {predict ? <PredictBody predict={predict} gates={gates} /> : <div className="empty-state"><Icon name="train" size={30} /><h3>{place ? "See what’s on the line" : "Choose an area first"}</h3><p>{place ? "Check trains to see approaching services and their estimated crossing times." : "Use the search above the map to find your crossings."}</p></div>}
          </>}
          {tab === "saved" && <>
            <div className="content-heading"><h2>Saved gates</h2><span className="count-label">{favorites.length}</span></div>
            <p className="section-caption">A shortcut to the crossings you use most.</p>
            <SavedGates items={favorites} onOpen={props.onOpenSaved} onRename={props.onRenameSaved} onRemove={props.onRemoveSaved} />
          </>}
          {error && tab !== "saved" && <p className="notice" role="status">{friendlyError(error)}</p>}
        </>}
      </div>
    </aside>
    {settingsOpen && <Dialog title="Settings" onClose={() => setSettingsOpen(false)}>
      <section className="settings-section"><h3>Appearance</h3><p className="quiet">Choose the map and app theme.</p><div className="theme-options">
        {(["light", "dark"] as const).map((mode) => <button key={mode} type="button" className="ghost" aria-pressed={theme === mode} onClick={() => { if (theme !== mode) props.onTheme(); }}>{mode === "light" ? "Light" : "Dark"}</button>)}
      </div></section>
      <section className="settings-section"><h3>Automatic checks</h3><p className="quiet">Keep reports updated while the app is visible.</p><RefreshControls settings={refresh} onChange={props.onRefresh} hasPlace={Boolean(place)} paused={props.paused} /></section>
    </Dialog>}
  </>;
}

function CrossingTimingRow({ group }: { group: CrossingTimingGroup }) {
  const { first, members } = group;
  const label = (row: typeof first) => row.status === "uncertain" ? "Position update needed" : row.eta == null ? "Track timing unknown" : gateLabel(row.eta, row.closesIn, row.status);
  const uncertain = members.some((row) => row.status === "uncertain");
  const unknown = members.some((row) => row.eta == null);
  const warning = uncertain ? "Position update needed" : unknown ? "Some track timings unknown" : "";
  return <li className="timing-group">
    <div className="timing-summary"><span>{group.label}</span><span>{warning ? <>{warning}{first.eta != null && first.status !== "uncertain" && <small className="track-first-estimate">First track estimate · {label(first)}</small>}</> : <>{members.length > 1 ? "First track · " : ""}{label(first)}</>}</span></div>
    {members.length > 1 && <details className="track-checks"><summary>{members.length} track checks</summary><ul>{members.map((row) => <li key={row.key}><span>Gate {row.key}</span><span>{label(row)}</span></li>)}</ul></details>}
  </li>;
}

function CheckedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return <p className="checked">{checkedAgo(at, now)}</p>;
}

function lede(
  place: { lat: number; lon: number } | null,
  loading: boolean,
  note: string | null,
  gateCount: number,
  placeLabel: string | null,
) {
  if (!place) {
    return "Highlighted lines are the railway. Search an Indian city, tap the map, or share your location.";
  }
  if (loading) return placeLabel ? `Looking up crossings in ${placeLabel}…` : "Looking up crossings…";
  const where = placeLabel ? `${placeLabel} · ` : "";
  if (note) return `${where}Crossings for this place did not load.`;
  if (gateCount === 0) return `${where}No railway crossings on the map here.`;
  return `${where}${gateCount} ${gateCount === 1 ? "crossing" : "crossings"} on this map.`;
}

export function PredictBody({ predict, gates }: { predict: Predict; gates: Gate[] }) {
  if (predict.error) return <p className="warn">{friendlyError(predict.error)}</p>;
  const approaching = predict.approaching ?? [];
  const passed = predict.passed ?? [];
  const shownNumbers = new Set([...approaching.map(runKey), ...passed.map(runKey)]);
  const sightings = (predict.sightings ?? []).filter(
    (row) => (row.age ?? 0) < 45 && !row.passed_local && !shownNumbers.has(runKey(row)),
  );
  const grouped = new Map<string, Approach[]>();
  for (const row of approaching) {
    const list = grouped.get(runKey(row)) ?? [];
    list.push(row);
    grouped.set(runKey(row), list);
  }
  if (grouped.size === 0 && sightings.length === 0 && passed.length === 0) {
    return <><CoverageNotice coverage={predict.coverage} /><AwaitingUpdate trains={predict.awaiting_update} /><OperatingUpdates updates={predict.service_updates} />{!predict.awaiting_update?.length && <p className="quiet">No train estimates available on this stretch right now.</p>}</>;
  }
  return (
    <div className="results">
      <CoverageNotice coverage={predict.coverage} />
      <AwaitingUpdate trains={predict.awaiting_update} /><OperatingUpdates updates={predict.service_updates} />
      {grouped.size === 0 && !predict.awaiting_update?.length ? (
        <p className="quiet">No approaching train was found in the available reports. Gate position is unknown.</p>
      ) : (
        [...grouped.entries()].map(([number, rows]) => {
          const ordered = [...rows].sort((a, b) => a.eta - b.eta);
          const head = ordered[0];
          const exact = predict.gate_predictions?.filter((row) => runKey(row) === number).sort((a, b) => a.eta - b.eta);
          const timingRows = exact?.length ? exact.map((row) => ({ key: row.id, label: gates.find((gate) => gate.id === row.id)?.name || "Level crossing", eta: row.eta, closesIn: row.closes_in, status: row.status }))
            : ordered.map((row) => ({ key: `${row.cluster}-${row.lat}`, label: `${row.cluster}${(row.ids?.length ?? 0) > 1 ? ` · first of ${row.ids!.length} gates` : ""}`, eta: row.eta, closesIn: row.closes_in, status: row.status }));
          const awaitingRows = (predict.awaiting_update ?? []).filter((row) => runKey(row) === number).flatMap((row) => (row.ids ?? []).filter((id) => !timingRows.some((timing) => timing.key === id)).map((id) => ({
            key: id, label: gates.find((gate) => gate.id === id)?.name || "Level crossing", status: "uncertain",
          })));
          const timings = groupCrossingTimings([...timingRows, ...awaitingRows], gates);
          return (
            <article key={number} className="train">
              <header>
                <strong>
                  {head.train} {head.name} {runDateLabel(head)}
                </strong>
                <span className={`pip ${head.status}`}>{`Est. ${labelStatus(head.status)}`}</span>
              </header>
              <p className="quiet">{head.basis === "timetable" ? "Timetable estimate" : "Train report"}{head.age_min != null ? ` · ${Math.round(head.age_min)} min old at check` : ""}</p>
              <ul>
                {timings.slice(0, 2).map((row) => <CrossingTimingRow key={row.key} group={row} />)}
              </ul>
              {timings.length > 2 && <details className="disclosure"><summary>{timings.length - 2} more crossings</summary><ul>{timings.slice(2).map((row) => <CrossingTimingRow key={row.key} group={row} />)}</ul></details>}
              <details className="disclosure"><summary>Route and report details</summary><RunLines row={head} showDelay />{head.bracket && <p className="quiet">{head.bracket}</p>}</details>
            </article>
          );
        })
      )}
      {passed.length > 0 ? (
        <details className="line disclosure train-group">
          <summary>Recently passed ({passed.length})</summary>
          {passed.slice(0, 6).map((row) => (
            <article key={`${runKey(row)}-${row.cluster}`} className="train">
              <header>
                <strong>
                  {row.train} {row.name} {runDateLabel(row)}
                </strong>
                <span className="pip passed">{labelStatus("passed")}</span>
              </header>
              <p>
                {passedLabel(row.ago)} at {row.cluster || "a crossing near you"}
              </p>
            </article>
          ))}
        </details>
      ) : null}
      {sightings.length > 0 ? (
        <details className="line disclosure train-group">
          <summary>Other trains on this line ({Math.min(sightings.length, 6)})</summary>
          {sightings.slice(0, 6).map((row) => (
            <article key={runKey(row)} className="train">
              <header>
                <strong>
                  {row.number} {row.name} {runDateLabel(row)}
                </strong>
                <span className={`pip ${delayClass(row.delay)}`}>{delayLabel(row.delay)}</span>
              </header>
              <RunLines row={row} />
              {(row.age ?? 0) >= 8 ? <p className="quiet">Reported {Math.round(row.age)} min ago</p> : null}
            </article>
          ))}
        </details>
      ) : null}
    </div>
  );
}

type RunBits = {
  current?: string;
  at_station?: boolean;
  origin?: string;
  dest?: string;
  next?: string;
  next_in?: string;
  departed_at?: string;
  scheduled_at?: string;
  platform?: string;
  left_km?: number;
  run?: string;
  delay?: number;
};

function RunLines({ row, showDelay = false }: { row: RunBits; showDelay?: boolean }) {
  const where = cleanPlace(row.current || "");
  let place = "";
  if (row.run === "departed" && row.departed_at && where) {
    place = `Departed ${where} at ${row.departed_at}`;
  } else if ((row.run === "at" || row.at_station) && where) {
    place = `At ${where}`;
  } else if (where) {
    place = `Last reported at ${where}`;
  }
  if (place && row.platform) place += `, platform ${row.platform}`;
  const next = [row.next ? `Next ${cleanPlace(row.next)}` : "", row.next_in || "", row.left_km ? `${row.left_km} km left` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {row.origin && row.dest ? (
        <p>
          {cleanPlace(row.origin)} to {cleanPlace(row.dest)}
        </p>
      ) : null}
      {place ? <p>{place}</p> : null}
      {row.scheduled_at ? <p className="quiet">Scheduled {row.scheduled_at}</p> : null}
      {showDelay && row.delay ? <p className="quiet">{delayLabel(row.delay)}</p> : null}
      {next ? <p>{next}</p> : null}
    </>
  );
}

function cleanPlace(value: string): string {
  return value
    .replace(/~/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const key = word.toUpperCase().replace(/\./g, "");
      if (key === "JN") return "Jn";
      if (key === "CNTL") return "Central";
      return word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word;
    })
    .join(" ");
}

function delayLabel(minutes: number): string {
  if (minutes > 0) return `${minutes} min late`;
  if (minutes < 0) return `${Math.abs(minutes)} min early`;
  return "On time";
}

function delayClass(minutes: number): string {
  if (minutes > 0) return "late";
  if (minutes < 0) return "early";
  return "ontime";
}
