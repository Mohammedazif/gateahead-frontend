import { useEffect, useState } from "react";

import type { Approach, City, Gate, Predict } from "../api";
import { friendlyError } from "../api";
import type { Theme } from "../theme";
import { CitySearch } from "./CitySearch";
import { checkedAgo } from "./checked";

type Props = {
  place: { lat: number; lon: number } | null;
  gates: Gate[];
  selectedId: string | null;
  gateCount: number;
  loading: boolean;
  busy: boolean;
  locating: boolean;
  error: string | null;
  note: string | null;
  predict: Predict | null;
  checkedAt: number | null;
  theme: Theme;
  cityLabel: string | null;
  onCheck: () => void;
  onLocate: () => void;
  onTheme: () => void;
  onSelect: (gate: Gate) => void;
  onCity: (city: City) => void;
};

export function TrainSheet({
  place,
  gates,
  selectedId,
  gateCount,
  loading,
  busy,
  locating,
  error,
  note,
  predict,
  checkedAt,
  theme,
  cityLabel,
  onCheck,
  onLocate,
  onTheme,
  onSelect,
  onCity,
}: Props) {
  const ranked = [...gates].sort((a, b) => {
    const aHot = a.eta == null ? 1 : 0;
    const bHot = b.eta == null ? 1 : 0;
    if (aHot !== bHot) return aHot - bHot;
    if (a.eta != null && b.eta != null && a.eta !== b.eta) return a.eta - b.eta;
    return a.km - b.km;
  });
  const hot = ranked.filter((gate) => gate.eta != null);
  const shown = [...hot, ...ranked.filter((gate) => gate.eta == null).slice(0, 12)];
  return (
    <aside className="sheet">
      <div className="sheet-head">
        <div className="sheet-title">
          <div>
            <p className="eyebrow">Crossings</p>
            <h1>GateAhead</h1>
          </div>
          <button type="button" className="ghost theme-toggle" onClick={onTheme}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
        <p className="lede">{lede(place, loading, note, gateCount, cityLabel)}</p>
        <CitySearch onPick={onCity} />
        <div className="actions">
          <button type="button" className="ghost" onClick={onLocate}>
            {locating ? "Finding…" : "Use my location"}
          </button>
          <button type="button" className="solid" onClick={onCheck} disabled={!place || busy}>
            {busy ? "Checking…" : "Check trains"}
          </button>
        </div>
        {checkedAt != null ? <CheckedAgo at={checkedAt} /> : null}
        {error ? <p className="warn">{friendlyError(error)}</p> : null}
        {note ? <p className="warn">{note}</p> : null}
      </div>
      <div className="sheet-body">
      {predict ? <PredictBody predict={predict} /> : null}
      {shown.length > 0 ? (
        <div className="gates">
          <p className="eyebrow">On the map</p>
          <ul>
            {shown.map((gate) => (
              <li key={gate.id}>
                <button
                  type="button"
                  className={gate.eta != null ? "hot" : undefined}
                  aria-pressed={gate.id === selectedId}
                  onClick={() => onSelect(gate)}
                >
                  <span>{gate.name || "Level crossing"}</span>
                  <span>{gate.eta != null ? etaLabel(gate.eta) : `${gate.km.toFixed(1)} km`}</span>
                </button>
              </li>
            ))}
          </ul>
          {gates.length > shown.length ? <p className="quiet">The rest are marked on the map.</p> : null}
        </div>
      ) : null}
      <p className="hint">Tap a crossing to watch the train on the map. Nothing is sent unless you ask.</p>
      </div>
    </aside>
  );
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
  cityLabel: string | null,
) {
  if (!place) {
    return "Highlighted lines are the railway. Search an Indian city, tap the map, or share your location.";
  }
  if (loading) return cityLabel ? `Looking up crossings in ${cityLabel}…` : "Looking up crossings…";
  if (note) return "Crossings for this place did not load.";
  const where = cityLabel ? `${cityLabel}. ` : "";
  if (gateCount === 0) return `${where}No railway crossings on the map here.`;
  return `${where}${gateCount} crossings on this map.`;
}

function PredictBody({ predict }: { predict: Predict }) {
  if (predict.error) return <p className="warn">{friendlyError(predict.error)}</p>;
  const approaching = predict.approaching ?? [];
  const shownNumbers = new Set(approaching.map((row) => row.train));
  const sightings = (predict.sightings ?? []).filter(
    (row) => (row.age ?? 0) < 45 && !row.passed_local && !shownNumbers.has(row.number),
  );
  const grouped = new Map<string, Approach[]>();
  for (const row of approaching) {
    const list = grouped.get(row.train) ?? [];
    list.push(row);
    grouped.set(row.train, list);
  }
  if (grouped.size === 0 && sightings.length === 0) {
    return <p className="quiet">No live trains reported on this stretch right now.</p>;
  }
  return (
    <div className="results">
      {grouped.size === 0 ? (
        <p className="quiet">No train is close enough to close a crossing near you right now.</p>
      ) : (
        [...grouped.entries()].map(([number, rows]) => {
          const ordered = [...rows].sort((a, b) => a.eta - b.eta);
          const head = ordered[0];
          return (
            <article key={number} className="train">
              <header>
                <strong>
                  {number} {head.name}
                </strong>
                <span className={`pip ${head.status}`}>{labelStatus(head.status)}</span>
              </header>
              <RunLines row={head} showDelay />
              <ul>
                {ordered.map((row) => (
                  <li key={`${row.cluster}-${row.lat}`}>
                    <span>{row.cluster}</span>
                    <span>{etaLabel(row.eta)}</span>
                  </li>
                ))}
              </ul>
              {head.bracket ? <p className="bracket">{head.bracket}</p> : null}
            </article>
          );
        })
      )}
      {sightings.length > 0 ? (
        <div className="line">
          <p className="eyebrow">On this line</p>
          {sightings.slice(0, 6).map((row) => (
            <article key={row.number} className="train">
              <header>
                <strong>
                  {row.number} {row.name}
                </strong>
                <span className={`pip ${delayClass(row.delay)}`}>{delayLabel(row.delay)}</span>
              </header>
              <RunLines row={row} />
              {(row.age ?? 0) >= 8 ? <p className="quiet">Reported {Math.round(row.age)} min ago</p> : null}
            </article>
          ))}
        </div>
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

function etaLabel(minutes: number): string {
  if (minutes <= 1) return "closing now";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (mins === 0) return `closes in ${hours} hr`;
    return `closes in ${hours} hr ${mins} min`;
  }
  return `closes in ${Math.round(minutes)} min`;
}

function labelStatus(status: string): string {
  if (status === "closed") return "Closed";
  if (status === "closing_soon") return "Closing";
  if (status === "approaching") return "Approaching";
  if (status === "later") return "Later";
  return status;
}
