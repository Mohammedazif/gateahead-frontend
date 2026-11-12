import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchGates, fetchPlaceName, fetchPredict, fetchScene, friendlyError, type Gate, type Predict, type Scene } from "./api";
import { MapView } from "./map/MapView";
import type { MapRun } from "./map/playback";
import { TrainSheet } from "./sheet/TrainSheet";
import { applyTheme, readTheme, type Theme } from "./theme";

type Place = { lat: number; lon: number };
type Press = Place & { x: number; y: number };

export function App() {
  const [place, setPlace] = useState<Place | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [gatesNote, setGatesNote] = useState<string | null>(null);
  const [loadingGates, setLoadingGates] = useState(false);
  const [predict, setPredict] = useState<Predict | null>(null);
  const [checking, setChecking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Gate | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [sceneState, setSceneState] = useState<"closed" | "loading" | "open">("closed");
  const [sceneMessage, setSceneMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Press | null>(null);
  const [spotName, setSpotName] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const sceneTicket = useRef(0);
  const confirmLock = useRef(false);

  const closeScene = useCallback(() => {
    sceneTicket.current += 1;
    setSceneState("closed");
    setScene(null);
    setSceneMessage(null);
    setSelected(null);
  }, []);

  const askPlace = useCallback((lat: number, lon: number, point: { x: number; y: number }) => {
    setSpotName(null);
    setNaming(true);
    setPending({ lat, lon, x: point.x, y: point.y });
  }, []);

  const choosePlace = useCallback(
    (lat: number, lon: number) => {
      sceneTicket.current += 1;
      setPending(null);
      setPlace({ lat, lon });
      setPredict(null);
      setError(null);
      setSelected(null);
      setScene(null);
      setSceneState("closed");
      setSceneMessage(null);
    },
    [],
  );

  const confirmPlace = useCallback(() => {
    if (!pending || confirmLock.current) return;
    confirmLock.current = true;
    const next = pending;
    setPending(null);
    choosePlace(next.lat, next.lon);
  }, [pending, choosePlace]);

  useEffect(() => {
    if (!place) {
      setGates([]);
      setGatesNote(null);
      return;
    }
    const ctrl = new AbortController();
    setLoadingGates(true);
    setGatesNote(null);
    fetchGates(place.lat, place.lon, ctrl.signal)
      .then((body) => {
        setGates(body.gates ?? []);
        setGatesNote(body.error ? friendlyError(body.error) : null);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setGates([]);
        setGatesNote(err instanceof Error ? err.message : "Could not load crossings.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingGates(false);
      });
    return () => ctrl.abort();
  }, [place]);

  useEffect(() => {
    confirmLock.current = false;
  }, [pending]);

  useEffect(() => {
    if (!pending) {
      setSpotName(null);
      setNaming(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetchPlaceName(pending.lat, pending.lon, ctrl.signal)
        .then((body) => {
          if (!ctrl.signal.aborted) setSpotName(body.name?.trim() || null);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSpotName(null);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setNaming(false);
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPending(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  useEffect(() => {
    if (sceneState === "closed") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeScene();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneState, closeScene]);

  function locate() {
    if (!navigator.geolocation) {
      setError("This browser cannot share a location. Tap the map instead.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        choosePlace(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        setError("Location was blocked. Tap the map to drop a pin.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  async function check() {
    if (!place || checking) return;
    setChecking(true);
    setError(null);
    try {
      setPredict(await fetchPredict(place.lat, place.lon));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check trains.");
    } finally {
      setChecking(false);
    }
  }

  async function openGate(gate: Gate) {
    if (!place) return;
    const ticket = ++sceneTicket.current;
    setSelected(gate);
    setSceneState("loading");
    setScene(null);
    setSceneMessage(null);
    try {
      const body = await fetchScene(place.lat, place.lon, gate.id);
      if (ticket !== sceneTicket.current) return;
      if (!body.available || (body.rail?.length ?? 0) < 2) {
        setScene(body);
        setSceneMessage(
          body.error
            ? friendlyError(body.error)
            : "This crossing has no rail line on the map, so the train stays off it.",
        );
        setSceneState("open");
        return;
      }
      setScene(body);
      setSceneState("open");
    } catch (err) {
      if (ticket !== sceneTicket.current) return;
      setSceneMessage(err instanceof Error ? err.message : "Could not open this crossing.");
      setSceneState("open");
    }
  }

  const ready = isReady(scene) ? scene : null;
  const marked = useMemo(() => markClosing(gates, predict), [gates, predict]);
  const run = useMemo<MapRun | null>(() => {
    if (!ready) return null;
    const lead = ready.trains[0] ?? null;
    return {
      id: ready.crossing.id,
      rail: ready.rail,
      crossing: { lat: ready.crossing.lat, lon: ready.crossing.lon },
      train: lead ? { alongKm: lead.along_km, status: lead.status } : null,
    };
  }, [ready]);

  return (
    <div className="app">
      <div className="map-wrap">
        <MapView
          place={place}
          pending={pending}
          gates={marked}
          selectedId={selected?.id ?? null}
          run={run}
          theme={theme}
          onPlace={askPlace}
          onSelect={openGate}
        />
        {sceneState !== "closed" ? (
          <div className="run-card">
            <div className="run-copy">
              <SceneCopy scene={scene} picked={selected} message={sceneState === "loading" ? "Opening the crossing…" : sceneMessage} />
            </div>
            <button type="button" className="close" onClick={closeScene}>
              Close
            </button>
          </div>
        ) : null}
      </div>
      <TrainSheet
        place={place}
        gates={marked}
        selectedId={selected?.id ?? null}
        gateCount={gates.length}
        loading={loadingGates}
        busy={checking}
        locating={locating}
        error={error}
        note={gatesNote}
        predict={predict}
        theme={theme}
        onCheck={check}
        onLocate={locate}
        onTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onSelect={openGate}
      />
      {pending ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="place-title">
          <div className="modal-backdrop" onClick={() => setPending(null)} />
          <div className="modal-card" style={cardAnchor(pending)}>
            <p className="eyebrow">You tapped</p>
            <h2 id="place-title">
              {spotName ?? (naming ? "Finding this place…" : formatSpot(pending.lat, pending.lon))}
            </h2>
            <p className="lede">Look up crossings at this point?</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="solid" onClick={confirmPlace} autoFocus>
                Look up
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatSpot(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function cardAnchor(spot: Press): { left: number; top: number; width: number } {
  const margin = 12;
  const gap = 18;
  const width = Math.min(380, window.innerWidth - margin * 2);
  const height = 210;
  const above = spot.y - height - gap;
  const top = above >= margin ? above : Math.min(spot.y + gap, window.innerHeight - height - margin);
  const left = Math.min(Math.max(margin, spot.x - width / 2), window.innerWidth - width - margin);
  return { left, top: Math.max(margin, top), width };
}

function markClosing(gates: Gate[], predict: Predict | null): Gate[] {
  const marks = new Map<string, { status: string; eta: number; label: string }>();
  for (const row of predict?.approaching ?? []) {
    for (const id of row.ids ?? []) {
      const prev = marks.get(id);
      if (!prev || row.eta < prev.eta) marks.set(id, { status: row.status, eta: row.eta, label: row.cluster });
    }
  }
  if (marks.size === 0) return gates;
  return gates.map((gate) => {
    const mark = marks.get(gate.id);
    if (!mark) return gate;
    return { ...gate, name: mark.label || gate.name, status: mark.status, eta: mark.eta };
  });
}

function isReady(
  scene: Scene | null,
): scene is Scene & { crossing: { id: string; name: string; lat: number; lon: number } } {
  return Boolean(scene && scene.available && scene.crossing && (scene.rail?.length ?? 0) >= 2);
}

function SceneCopy({ scene, picked, message }: { scene: Scene | null; picked: Gate | null; message: string | null }) {
  const crossing = scene?.crossing ?? picked;
  const lead = scene?.trains[0];
  return (
    <div>
      <p className="eyebrow">On the map</p>
      <h2>{crossing?.name || "Level crossing"}</h2>
      {message ? <p className="stage-sub">{message}</p> : null}
      {lead && !message ? (
        <p className="stage-sub">
          {lead.number} {lead.name}
          {" · "}
          {lead.eta_min <= 1 ? "closing now" : `closes in ${Math.round(lead.eta_min)} min`}
          {lead.age_min >= 8 ? " · last reported" : ""}
          {lead.bracket ? ` · ${lead.bracket}` : ""}
        </p>
      ) : null}
      {!message && scene && !lead ? (
        <p className="stage-sub">No train is close enough to close this crossing. The track stays in view.</p>
      ) : null}
      {!message && lead ? <p className="stage-sub">The gate closes the road. The train keeps the track.</p> : null}
    </div>
  );
}
