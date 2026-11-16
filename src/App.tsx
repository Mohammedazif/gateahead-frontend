import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cachedResponse, fetchGates, fetchPlaceName, fetchPredict, fetchScene, friendlyError, RequestError, type City, type Gate, type Predict, type Scene } from "./api";
import { MapView } from "./map/MapView";
import { frameForRun, type MapRun } from "./map/playback";
import { currentPrediction, currentScene, sceneFreshUntil, ESTIMATE_WINDOW_MS } from "./timing";
import { TrainSheet } from "./sheet/TrainSheet";
import { applyTheme, readTheme, type Theme } from "./theme";

import { defaultRefresh, inRefreshWindow, markGates, withGateChecks, readFavorites, readLink, readStored, validPlace, writeStored, type Place, type RefreshSettings, type SavedGate } from "./features";
import { LocationControl } from "./map/LocationControl";
type Press = Place & { x: number; y: number };

export function App() {
  const [initial] = useState(() => readLink(window.location.href) || readStored<Place | null>("last-place", null));
  const [place, setPlace] = useState<Place | null>(() => validPlace(initial) ? initial : null);
  const [favorites, setFavorites] = useState(readFavorites);
  const [refresh, setRefresh] = useState<RefreshSettings>(() => ({ ...defaultRefresh, ...readStored("refresh", defaultRefresh) }));
  const [now, setNow] = useState(Date.now());
  const [pausedUntil, setPausedUntil] = useState(() => readStored<number>("paused-until", 0));
  const [gatesCached, setGatesCached] = useState(false);
  const generation = useRef(0);
  const checkingLock = useRef(false);
  const lastAttempt = useRef(0);
  const refreshScene = useRef<() => void>(() => {});
  const wantedGate = useRef(initial && "gateId" in initial ? initial.gateId as string : null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { writeStored("favorites", favorites); }, [favorites]);
  useEffect(() => { writeStored("refresh", refresh); }, [refresh]);
  useEffect(() => { writeStored("paused-until", pausedUntil); }, [pausedUntil]);
  useEffect(() => { if (place) writeStored("last-place", place); }, [place]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [gatesNote, setGatesNote] = useState<string | null>(null);
  const [loadingGates, setLoadingGates] = useState(false);
  const [predict, setPredict] = useState<Predict | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Gate | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [gateChecks, setGateChecks] = useState<Record<string, Scene>>({});
  const [sceneState, setSceneState] = useState<"closed" | "loading" | "open">("closed");
  const [sceneMessage, setSceneMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Press | null>(null);
  const [spotName, setSpotName] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [placeLabel, setPlaceLabel] = useState<string | null>(() => place?.label || null);
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
    (lat: number, lon: number, label?: string | null) => {
      generation.current += 1;
      checkingLock.current = false;
      lastAttempt.current = 0;
      sceneTicket.current += 1;
      const knownLabel = label?.trim() || undefined;
      setPending(null);
      setPlace({ lat, lon, label: knownLabel });
      setPlaceLabel(knownLabel ?? formatSpot(lat, lon));
      setPredict(null);
      setGateChecks({});
      setCheckedAt(null);
      setChecking(false);
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
    choosePlace(next.lat, next.lon, spotName);
  }, [pending, spotName, choosePlace]);

  const pickCity = useCallback(
    (city: City) => {
      choosePlace(city.lat, city.lon, `${city.name}, ${city.state}`);
    },
    [choosePlace],
  );

  useEffect(() => {
    if (!place || place.label) return;
    const ctrl = new AbortController();
    fetchPlaceName(place.lat, place.lon, ctrl.signal)
      .then((body) => {
        const name = body.name?.trim();
        if (!ctrl.signal.aborted && name) setPlaceLabel(name);
      })
      .catch(() => {
        // Keep the coordinates when the place name is unavailable.
      });
    return () => ctrl.abort();
  }, [place]);

  useEffect(() => {
    if (!place) {
      setGates([]);
      setGatesNote(null);
      return;
    }
    const ctrl = new AbortController();
    const oldGates = cachedResponse(`/api/gates?lat=${place.lat}&lon=${place.lon}`);
    setGates((oldGates?.data.gates as Gate[] | undefined) || []);
    setGatesCached(Boolean(oldGates));
    const oldPredict = cachedResponse(`/api/predict?lat=${place.lat}&lon=${place.lon}`);
    setPredict(oldPredict ? { ...oldPredict.data, cached_at: oldPredict.at, offline: true } as Predict : null);
    setCheckedAt(oldPredict?.at || null);
    setLoadingGates(true);
    setGatesNote(null);
    fetchGates(place.lat, place.lon, ctrl.signal)
      .then((body) => {
        setGates(body.gates ?? []);
        setGatesCached(Boolean(body.offline));
        setGatesNote(body.error ? friendlyError(body.error) : null);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (!oldGates) setGates([]);
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

  const check = useCallback(async (automatic = false) => {
    if (!place || checkingLock.current) return;
    if (Date.now() < pausedUntil) {
      if (!automatic) setError(`Checks are paused until ${new Date(pausedUntil).toLocaleTimeString()}.`);
      return;
    }
    if (Date.now() - lastAttempt.current < 90000) {
      if (!automatic) setError("Checked recently. Wait 90 seconds between train checks.");
      return;
    }
    const ticket = generation.current;
    checkingLock.current = true;
    lastAttempt.current = Date.now();
    setChecking(true); setError(null);
    try {
      const body = await fetchPredict(place.lat, place.lon);
      if (ticket !== generation.current) return;
      if (body.error) throw new Error(friendlyError(body.error));
      setPredict(body); setCheckedAt(body.cached_at || Date.now());
      if (!body.offline) refreshScene.current();
    } catch (err) {
      if (ticket !== generation.current) return;
      if (err instanceof RequestError && err.retryAt) setPausedUntil(err.retryAt);
      setError(err instanceof Error ? err.message : "Could not check trains.");
    } finally {
      if (ticket === generation.current) { checkingLock.current = false; setChecking(false); }
    }
  }, [place, pausedUntil]);

  useEffect(() => {
    const tick = () => {
      if (refresh.enabled && document.visibilityState === "visible" && navigator.onLine &&
          inRefreshWindow(refresh, new Date()) && Date.now() - lastAttempt.current >= 120000) void check(true);
    };
    const timer = window.setInterval(tick, 15000);
    return () => window.clearInterval(timer);
  }, [refresh, check]);

  function saveGate(gate: Gate) {
    if (!place) return;
    if (favorites.some((item) => item.gate.id === gate.id)) {
      setFavorites((items) => items.filter((item) => item.gate.id !== gate.id)); return;
    }
    const label = window.prompt("Name this saved gate", gate.name || "My gate")?.trim().slice(0, 80);
    if (label) setFavorites((items) => [...items, { gate: { ...gate, eta: undefined, status: undefined, closesIn: undefined }, label, place }].slice(-50));
  }
  function openSaved(item: SavedGate) {
    wantedGate.current = item.gate.id;
    choosePlace(item.place.lat, item.place.lon, item.place.label || item.label);
  }
  function renameSaved(item: SavedGate) {
    const label = window.prompt("Rename this gate", item.label)?.trim().slice(0, 80);
    if (label) setFavorites((items) => items.map((row) => row.gate.id === item.gate.id ? { ...row, label } : row));
  }

  async function openGate(gate: Gate, refreshing = false) {
    if (!place) return;
    const ticket = ++sceneTicket.current;
    setSelected(gate);
    setSceneState(refreshing ? "open" : "loading");
    if (!refreshing) setScene(null);
    setSceneMessage(null);
    try {
      const body = await fetchScene(place.lat, place.lon, gate.id, undefined, refreshing ? Date.now() : predict?.cached_at ?? checkedAt ?? 0);
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
      setGateChecks((checks) => ({ ...checks, [gate.id]: body }));
      setSceneState("open");
    } catch (err) {
      if (ticket !== sceneTicket.current) return;
      if (err instanceof RequestError && err.retryAt) setPausedUntil(err.retryAt);
      setSceneMessage(err instanceof Error ? err.message : "Could not open this crossing.");
      setSceneState("open");
    }
  }

  refreshScene.current = () => { if (selected) void openGate(selected, true); };

  useEffect(() => {
    if (loadingGates || !wantedGate.current) return;
    const gate = gates.find((item) => item.id === wantedGate.current) || favorites.find((item) => item.gate.id === wantedGate.current)?.gate;
    if (gate) { wantedGate.current = null; void openGate(gate); }
    // Opening a link waits for the crossing lookup to finish.
  }, [gates, loadingGates]);

  const historical = Boolean(predict?.offline || (checkedAt && now - checkedAt > ESTIMATE_WINDOW_MS));
  const sceneHistorical = Boolean(scene && (scene.offline || now > sceneFreshUntil(scene)));
  const checkedScenes = useMemo(() => Object.values(gateChecks)
    .filter((check) => !check.offline && now <= sceneFreshUntil(check))
    .map((check) => currentScene(check, now)!), [gateChecks, now]);
  const displayPredict = useMemo(() => withGateChecks(currentPrediction(predict, now), checkedScenes, gates), [predict, now, checkedScenes, gates]);
  const displayScene = useMemo(() => currentScene(scene, now), [scene, now]);
  const sceneLead = displayScene?.trains[0];
  const sceneLeadNumber = sceneLead?.number;
  const ready = isReady(scene) ? scene : null;
  const marked = useMemo(() => markGates(gates, historical ? null : displayPredict, checkedScenes), [gates, displayPredict, historical, checkedScenes]);
  const run = useMemo<MapRun | null>(() => {
    if (!ready) return null;
    const lead = sceneHistorical ? null : ready.trains.find((train) => train.number === sceneLeadNumber) ?? null;
    return {
      id: ready.crossing.id,
      rail: ready.rail,
      crossing: { lat: ready.crossing.lat, lon: ready.crossing.lon },
      train: lead ? { alongKm: lead.along_km, status: lead.status, onSegment: lead.position_on_segment === true, ageMin: lead.age_min, etaMin: lead.eta_min, closesInMin: lead.closes_in_min, snapshotAt: lead.snapshot_at == null ? ready.cached_at : lead.snapshot_at * 1000, motion: lead.motion } : null,
    };
  }, [ready, sceneHistorical, sceneLeadNumber]);

  const visibleTrain = run && frameForRun(run, now).train;
  const positionNote = !sceneLead ? null : sceneHistorical ? `${sceneLead.number} · saved crossing estimate · check trains to update`
    : sceneLead.age_min >= 8 ? `${sceneLead.number} · report ${Math.round(sceneLead.age_min)} min old · location unconfirmed`
    : sceneLead.movement === "stopped" ? `${sceneLead.number} · reported stopped · awaiting a moving report`
    : visibleTrain ? `${sceneLead.number} · ${sceneLead.motion ? "estimated train movement" : "reported position"}`
    : sceneLead.motion || sceneLead.position_on_segment === false ? `${sceneLead.number} · outside this crossing view · train due in ${Math.max(1, Math.round(sceneLead.eta_min))} min`
    : `${sceneLead.number} · train location not supplied by this check`;

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
        <LocationControl label={placeLabel} locating={locating} onCity={pickCity} onLocate={locate} />
        {selected && positionNote && <p className="map-position-note">{positionNote}</p>}
      </div>
      <TrainSheet
        place={place}
        gates={marked}
        selected={selected}
        scene={displayScene}
        sceneLoading={sceneState === "loading"}
        sceneMessage={sceneMessage}
        sceneHistorical={sceneHistorical}
        onCloseGate={closeScene}
        onSaveGate={saveGate}
        gateCount={gates.length}
        loading={loadingGates}
        busy={checking}
        error={error}
        note={gatesNote}
        predict={displayPredict}
        checkedAt={checkedAt}
        theme={theme}
        placeLabel={placeLabel}
        onCheck={() => void check()}
        favorites={favorites}
        onOpenSaved={openSaved}
        onRenameSaved={renameSaved}
        onRemoveSaved={(id) => setFavorites((items) => items.filter((item) => item.gate.id !== id))}
        refresh={refresh}
        onRefresh={setRefresh}
        paused={pausedUntil > now}
        historical={historical}
        gatesCached={gatesCached}
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

function isReady(
  scene: Scene | null,
): scene is Scene & { crossing: { id: string; name: string; lat: number; lon: number } } {
  return Boolean(scene && scene.available && scene.crossing && (scene.rail?.length ?? 0) >= 2);
}
