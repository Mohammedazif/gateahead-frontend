import { runKey } from "./runIdentity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cachedResponse, clearPrivateResponses, discardPersistedArea, fetchGates, fetchPlaceName, fetchPredict, fetchScene, friendlyError, isLegacyCrossingId, RequestError, trainPauseUntil, type City, type Gate, type Predict, type Scene } from "./api";
import { MapView } from "./map/MapView";
import { frameForRun, sceneRun } from "./map/playback";
import { currentPrediction, currentScene, sceneFreshUntil, ESTIMATE_WINDOW_MS } from "./timing";
import { TrainSheet } from "./sheet/TrainSheet";
import { applyTheme, readTheme, type Theme } from "./theme";
import { checkCommuteGates, COMMUTE_COOLDOWN_MS, MAX_COMMUTES, mergeCommuteResult, readCommuteResults, readCommutes, type Commute, type CommuteResult } from "./commute";

import { initialPlace, inRefreshWindow, markGates, withGateChecks, readFavorites, readRefresh, writeStored, type Place, type SavedGate } from "./features";
import { LocationControl } from "./map/LocationControl";
type Press = Place & { x: number; y: number };

export function App() {
  const [initial] = useState(() => initialPlace(window.location.href));
  const [place, setPlace] = useState<Place | null>(initial);
  const [favorites, setFavorites] = useState(readFavorites);
  const [commutes, setCommutes] = useState(readCommutes);
  const savedState = useRef({ favorites, commutes });
  const [savedNotice, setSavedNotice] = useState("");
  const [commuteResults, setCommuteResults] = useState<Record<string, CommuteResult>>(() => readCommuteResults(commutes, favorites));
  const [checkingCommute, setCheckingCommute] = useState<string | null>(null);
  const [pendingCommuteGates, setPendingCommuteGates] = useState<string[]>([]);
  const [commuteReadyAt, setCommuteReadyAt] = useState(0);
  const commuteRequest = useRef<{ id: string; controller: AbortController; gateIds: string[] } | null>(null);
  const [refresh, setRefresh] = useState(readRefresh);
  const [now, setNow] = useState(Date.now());
  const [pausedUntil, setPausedUntil] = useState(trainPauseUntil);
  const [gatesCached, setGatesCached] = useState(false);
  const generation = useRef(0);
  const locationTicket = useRef(0);
  const predictRequest = useRef<AbortController | null>(null);
  const sceneRequest = useRef<AbortController | null>(null);
  const checkingLock = useRef(false);
  const lastAttempt = useRef(0);
  const refreshScene = useRef<() => void>(() => {});
  const wantedGate = useRef(initial?.gateId ?? null);
  useEffect(() => {
    if (!initial?.privateLocation && (!initial?.gateId || !isLegacyCrossingId(initial.gateId))) return;
    const url = new URL(window.location.href);
    for (const key of initial.privateLocation ? ["lat", "lon", "name", "gate"] : ["gate"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
  }, [initial]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => commuteRequest.current?.controller.abort(), []);
  useEffect(() => { writeStored("refresh", refresh); }, [refresh]);
  useEffect(() => {
    const updatePause = (event: StorageEvent) => {
      if (event.key !== "gateahead:paused-until") return;
      setPausedUntil((previous) => Math.max(previous, trainPauseUntil()));
    };
    window.addEventListener("storage", updatePause);
    return () => window.removeEventListener("storage", updatePause);
  }, []);
  useEffect(() => {
    const wait = Math.max(commuteReadyAt, pausedUntil) - Date.now();
    if (wait <= 0 || wait > 2_147_483_647) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [commuteReadyAt, pausedUntil]);
  useEffect(() => {
    if (!place) return;
    if (place.privateLocation) discardPersistedArea(place.lat, place.lon);
    writeStored("last-place", place.privateLocation ? null : { lat: place.lat, lon: place.lon, label: place.label });
  }, [place]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [gatesNote, setGatesNote] = useState<string | null>(null);
  const [gateSelectionNote, setGateSelectionNote] = useState<string | null>(null);
  const [loadingGates, setLoadingGates] = useState(Boolean(place));
  const [gatesAuthoritative, setGatesAuthoritative] = useState(false);
  const [gatesCheckedAt, setGatesCheckedAt] = useState(0);
  const [gateRetry, setGateRetry] = useState(0);
  const retryGates = useCallback(() => setGateRetry((attempt) => attempt + 1), []);
  const [predict, setPredict] = useState<Predict | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Gate | null>(null);
  const [focusedTrain, setFocusedTrain] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusTrain = useCallback((number: string) => { setFocusedTrain(number); setFocusRequest((value) => value + 1); }, []);
  useEffect(() => { setFocusedTrain(null); }, [selected?.id]);
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

  const cancelCommute = useCallback(() => {
    const request = commuteRequest.current;
    if (!request) return;
    commuteRequest.current = null;
    request.controller.abort();
    setCheckingCommute(null);
    setPendingCommuteGates([]);
  }, []);

  const closeScene = useCallback(() => {
    wantedGate.current = null;
    sceneTicket.current += 1;
    sceneRequest.current?.abort();
    setSceneState("closed");
    setScene(null);
    setSceneMessage(null);
    setSelected(null);
  }, []);

  const askPlace = useCallback((lat: number, lon: number, point: { x: number; y: number }) => {
    locationTicket.current += 1;
    setLocating(false);
    setSpotName(null);
    setNaming(true);
    setPending({ lat, lon, x: point.x, y: point.y });
  }, []);

  const choosePlace = useCallback(
    (lat: number, lon: number, label?: string | null, gateId: string | null = null, privateLocation = false) => {
      generation.current += 1;
      locationTicket.current += 1;
      predictRequest.current?.abort();
      sceneRequest.current?.abort();
      cancelCommute();
      clearPrivateResponses();
      wantedGate.current = gateId;
      checkingLock.current = false;
      lastAttempt.current = 0;
      sceneTicket.current += 1;
      const knownLabel = label?.trim() || undefined;
      // A manual choice supersedes the incoming shared-link location. Keep
      // reloads on the area the person chose instead of replaying the old link.
      const url = new URL(window.location.href);
      for (const key of ["lat", "lon", "name", "gate"]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
      setPending(null);
      setPlace({ lat, lon, label: knownLabel, privateLocation });
      setPlaceLabel(knownLabel ?? formatSpot(lat, lon));
      setPredict(null);
      setGateChecks({});
      setCheckedAt(null);
      setChecking(false);
      setLocating(false);
      setError(null);
      setGates([]);
      setGatesCached(false);
      setGatesNote(null);
      setGateSelectionNote(null);
      setGatesAuthoritative(false);
      setGatesCheckedAt(0);
      setLoadingGates(true);
      setSelected(null);
      setScene(null);
      setSceneState("closed");
      setSceneMessage(null);
    },
    [cancelCommute],
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
    if (!place) return;
    const oldGates = cachedResponse(`/api/gates?lat=${place.lat}&lon=${place.lon}`, place.privateLocation);
    setGates((oldGates?.data.gates as Gate[] | undefined) || []);
    setGatesCached(Boolean(oldGates));
    const oldPredict = cachedResponse(`/api/predict?lat=${place.lat}&lon=${place.lon}`, place.privateLocation);
    setPredict(oldPredict ? { ...oldPredict.data, cached_at: oldPredict.at, offline: true } as Predict : null);
    setCheckedAt(oldPredict?.at || null);
  }, [place]);

  useEffect(() => {
    if (!place) return;
    const ctrl = new AbortController();
    const ticket = generation.current;
    setLoadingGates(true);
    fetchGates(place.lat, place.lon, ctrl.signal, place.privateLocation)
      .then((body) => {
        if (ctrl.signal.aborted || ticket !== generation.current) return;
        if (!body.error) setGates(body.gates);
        const warning = body.error ?? body.map_warning;
        const authority = !body.offline && !warning;
        if (authority) setGatesCheckedAt(body.cached_at ?? Date.now());
        setGatesCached(Boolean(body.offline || body.map_warning));
        setGatesAuthoritative(authority);
        setGatesNote(warning ? friendlyError(warning) : null);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || ticket !== generation.current) return;
        setGatesAuthoritative(false);
        setGatesNote(err instanceof Error ? err.message : "Could not load crossings.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted && ticket === generation.current) setLoadingGates(false);
      });
    return () => ctrl.abort();
  }, [place, gateRetry]);

  useEffect(() => {
    if (!place || loadingGates || gatesAuthoritative) return;
    const retryVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) retryGates(); };
    window.addEventListener("online", retryVisible);
    document.addEventListener("visibilitychange", retryVisible);
    return () => {
      window.removeEventListener("online", retryVisible);
      document.removeEventListener("visibilitychange", retryVisible);
    };
  }, [place, loadingGates, gatesAuthoritative, retryGates]);

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
      if (event.key === "Escape" && !pending) closeScene();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneState, closeScene, pending]);

  function locate() {
    if (!navigator.geolocation) {
      setError("This browser cannot share a location. Tap the map instead.");
      return;
    }
    setLocating(true);
    setError(null);
    const ticket = ++locationTicket.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (ticket !== locationTicket.current) return;
        setLocating(false);
        choosePlace(pos.coords.latitude, pos.coords.longitude, null, null, true);
      },
      (error) => {
        if (ticket !== locationTicket.current) return;
        setLocating(false);
        setError(error.code === 1 ? "Location was blocked. Tap the map to drop a pin." : error.code === 3
          ? "Finding your location timed out. Try again or tap the map to drop a pin."
          : "Your location is unavailable. Search a city or tap the map to drop a pin.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  const check = useCallback(async (automatic = false) => {
    if (!place || checkingLock.current || commuteRequest.current) return;
    const pause = Math.max(pausedUntil, trainPauseUntil());
    if (Date.now() < pause) {
      setPausedUntil(pause);
      if (!automatic) setError(`Checks are paused until ${new Date(pause).toLocaleTimeString()}.`);
      return;
    }
    if (Date.now() - lastAttempt.current < 90000) {
      if (!automatic) setError("Checked recently. Wait 90 seconds between train checks.");
      return;
    }
    const ticket = generation.current;
    checkingLock.current = true;
    const ctrl = new AbortController();
    predictRequest.current = ctrl;
    lastAttempt.current = Date.now();
    setChecking(true); setError(null);
    let receivedUpdate = false;
    try {
      const body = await fetchPredict(place.lat, place.lon, ctrl.signal, place.privateLocation, (update) => {
        if (ticket !== generation.current || ctrl.signal.aborted) return;
        receivedUpdate = true;
        setPredict(update);
        setCheckedAt(Date.now());
      });
      if (ticket !== generation.current) return;
      if (body.error) throw new Error(friendlyError(body.error));
      if (body.offline && receivedUpdate) throw new Error("Could not finish this train check. Showing the results received so far.");
      setPredict(body); setCheckedAt(body.cached_at || Date.now());
      if (!body.offline) refreshScene.current();
    } catch (err) {
      if (ticket !== generation.current) return;
      if (err instanceof RequestError && err.retryAt) setPausedUntil((previous) => Math.max(previous, err.retryAt));
      setError(err instanceof Error ? err.message : "Could not check trains.");
    } finally {
      if (ticket === generation.current) {
        checkingLock.current = false;
        if (receivedUpdate) setPredict((previous) => previous?.coverage?.checking
          ? { ...previous, coverage: { ...previous.coverage, checking: false } }
          : previous);
        setChecking(false);
      }
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

  function saveGate(gate: Gate, label: string): boolean {
    const current = savedState.current.favorites;
    if (!place || current.some((item) => item.gate.id === gate.id)) return false;
    const savedPlace = place.privateLocation ? { lat: gate.lat, lon: gate.lon, label: gate.name } : place;
    const next = [...current, { gate: { ...gate, eta: undefined, status: undefined, closesIn: undefined }, label, place: savedPlace }].slice(-50);
    return updateFavorites(next);
  }
  function openSaved(item: SavedGate) {
    choosePlace(item.place.lat, item.place.lon, item.place.label || item.label, item.gate.id);
  }
  function renameSaved(id: string, label: string): boolean {
    const current = savedState.current.favorites;
    if (!current.some((item) => item.gate.id === id)) return false;
    return updateFavorites(current.map((item) => item.gate.id === id ? { ...item, label } : item));
  }

  function removeSaved(id: string) {
    updateFavorites(savedState.current.favorites.filter((item) => item.gate.id !== id));
  }

  function commitSaved(next: { favorites: SavedGate[]; commutes: Commute[] }): boolean {
    const previous = savedState.current;
    const changedFavorites = next.favorites !== previous.favorites;
    const changedCommutes = next.commutes !== previous.commutes;
    if (!changedFavorites && !changedCommutes) return true;
    if (changedFavorites && !writeStored("favorites", next.favorites)) return false;
    if (changedCommutes && !writeStored("commutes", next.commutes)) {
      if (changedFavorites) writeStored("favorites", previous.favorites);
      return false;
    }
    savedState.current = next;
    setSavedNotice("");
    if (changedFavorites) setFavorites(next.favorites);
    if (changedCommutes) {
      setCommutes(next.commutes);
      const remaining = new Set(next.commutes.flatMap((trip) => trip.gateIds));
      setCommuteResults((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => remaining.has(id))));
    }
    return true;
  }

  function updateFavorites(next: SavedGate[]): boolean {
    const ids = new Set(next.map((favorite) => favorite.gate.id));
    const trips = savedState.current.commutes;
    const keepsEveryStop = trips.every((trip) => trip.gateIds.every((id) => ids.has(id)));
    const updated = keepsEveryStop ? trips : trips.map((trip) => ({ ...trip, gateIds: trip.gateIds.filter((id) => ids.has(id)) }))
      .filter((trip) => trip.gateIds.length);
    const saved = commitSaved({ favorites: next, commutes: updated });
    if (!saved) {
      setSavedNotice("Could not update saved crossings on this device.");
    } else if (commuteRequest.current?.gateIds.some((id) => !ids.has(id))) {
      cancelCommute();
    }
    return saved;
  }

  function saveCommute(commute: Commute): boolean {
    const current = savedState.current;
    const existing = current.commutes.find((trip) => trip.id === commute.id);
    if (!existing && current.commutes.length >= MAX_COMMUTES) return false;
    const saved = commitSaved({ ...current, commutes: existing
      ? current.commutes.map((trip) => trip.id === commute.id ? commute : trip)
      : [...current.commutes, commute] });
    if (saved && commuteRequest.current?.id === commute.id &&
        existing?.gateIds.join("\0") !== commute.gateIds.join("\0")) cancelCommute();
    return saved;
  }

  function removeCommute(id: string): boolean {
    const current = savedState.current;
    const saved = commitSaved({ ...current, commutes: current.commutes.filter((trip) => trip.id !== id) });
    if (saved && commuteRequest.current?.id === id) cancelCommute();
    return saved;
  }

  function migrateCrossing(gate: Gate, crossing: NonNullable<Scene["crossing"]>): { gate: Gate; persisted: boolean } {
    const resolved = gates.find((item) => item.id === crossing.id) ?? { ...gate, ...crossing };
    const current = savedState.current;
    if (!current.favorites.some((item) => item.gate.id === gate.id)) return { gate: resolved, persisted: true };
    const updatedFavorites = current.favorites.some((item) => item.gate.id === resolved.id)
      ? current.favorites.filter((item) => item.gate.id !== gate.id)
      : current.favorites.map((item) => item.gate.id === gate.id ? { ...item, gate: resolved } : item);
    const updatedCommutes = current.commutes.some((trip) => trip.gateIds.includes(gate.id))
      ? current.commutes.map((trip) => ({ ...trip,
        gateIds: [...new Set(trip.gateIds.map((id) => id === gate.id ? resolved.id : id))],
      })) : current.commutes;
    const persisted = commitSaved({ favorites: updatedFavorites, commutes: updatedCommutes });
    if (!persisted) setSavedNotice("Could not save the updated crossing identity on this device.");
    return { gate: resolved, persisted };
  }

  async function checkCommute(commute: Commute) {
    const started = Date.now();
    const pause = Math.max(pausedUntil, trainPauseUntil());
    if (commuteRequest.current || checkingLock.current || started < Math.max(commuteReadyAt, pause)) {
      setPausedUntil(pause);
      return;
    }
    const saved = new Map(favorites.map((item) => [item.gate.id, item]));
    const items = commute.gateIds.flatMap((id) => saved.get(id) ?? []);
    if (!items.length) return;

    const ctrl = new AbortController();
    commuteRequest.current = { id: commute.id, controller: ctrl, gateIds: items.map(({ gate }) => gate.id) };
    setCheckingCommute(commute.id);
    setPendingCommuteGates(items.map(({ gate }) => gate.id));
    setCommuteReadyAt(started + COMMUTE_COOLDOWN_MS);
    setNow(started);
    try {
      await checkCommuteGates(items, ctrl.signal,
        (requested, result) => {
          const crossing = result.scene?.crossing;
          const item = saved.get(requested);
          const canonical = crossing && crossing.id !== requested && item ? migrateCrossing(item.gate, crossing) : null;
          const id = canonical?.persisted ? canonical.gate.id : requested;
          if (!savedState.current.commutes.some((trip) => trip.gateIds.includes(id))) return;
          setPendingCommuteGates((previous) => previous.filter((pendingId) => pendingId !== requested));
          setCommuteResults((previous) => ({ ...previous, [id]: mergeCommuteResult(previous[id], result) }));
        },
        (retryAt) => setPausedUntil((previous) => Math.max(previous, retryAt)));
    } finally {
      if (commuteRequest.current?.controller === ctrl) {
        commuteRequest.current = null;
        setCheckingCommute(null);
        setPendingCommuteGates([]);
        setNow(Date.now());
      }
    }
  }

  async function openGate(gate: Gate, refreshing = false) {
    if (!place) return;
    wantedGate.current = null;
    setGateSelectionNote(null);
    const ticket = ++sceneTicket.current;
    sceneRequest.current?.abort();
    const ctrl = new AbortController();
    sceneRequest.current = ctrl;
    setSelected(gate);
    setSceneState(refreshing ? "open" : "loading");
    if (!refreshing) setScene(null);
    setSceneMessage(null);
    try {
      const body = await fetchScene(place.lat, place.lon, gate.id, ctrl.signal,
        refreshing ? Date.now() : predict?.cached_at ?? checkedAt ?? 0, place.privateLocation);
      if (ticket !== sceneTicket.current) return;
      const canonical = body.crossing && body.crossing.id !== gate.id ? body.crossing : null;
      if (canonical) setSelected(migrateCrossing(gate, canonical).gate);
      if (!body.available || (body.rail?.length ?? 0) < 2) {
        setScene(body);
        setSceneMessage(
          body.error
            ? friendlyError(body.error)
            : "A rail map is unavailable for this crossing.",
        );
        setSceneState("open");
        return;
      }
      setScene(body);
      if (!body.offline) setGateChecks((checks) => ({ ...checks, [canonical?.id ?? gate.id]: body }));
      setSceneState("open");
    } catch (err) {
      if (ticket !== sceneTicket.current) return;
      if (err instanceof RequestError && err.retryAt) setPausedUntil((previous) => Math.max(previous, err.retryAt));
      setSceneMessage(err instanceof Error ? err.message : "Could not open this crossing.");
      setSceneState("open");
    }
  }

  refreshScene.current = () => { if (selected) void openGate(selected, true); };

  useEffect(() => {
    const wanted = wantedGate.current;
    if (loadingGates || !wanted || !place) return;
    wantedGate.current = null;
    const gate = gates.find((item) => item.id === wanted);
    const favorite = favorites.find((item) => item.gate.id === wanted)?.gate;
    if (gate || (!gatesAuthoritative && favorite && !isLegacyCrossingId(wanted))) {
      void openGate(gate ?? favorite!);
    } else if (gatesAuthoritative && isLegacyCrossingId(wanted)) {
      void openGate(favorite ?? { id: wanted, name: place.label ?? "Saved crossing", lat: place.lat, lon: place.lon, km: 0, source: "saved" });
    } else {
      setGateSelectionNote(gatesAuthoritative ? "That crossing is no longer on the map." : "This crossing could not be checked. Try the crossing lookup again when online.");
    }
    // Opening a link waits for the crossing lookup to finish.
  }, [gates, loadingGates, gatesAuthoritative]);

  useEffect(() => {
    if (!selected || !gatesAuthoritative || loadingGates || sceneState !== "open" ||
        gatesCheckedAt < (scene?.cached_at ?? 0) || isLegacyCrossingId(selected.id) || gates.some((gate) => gate.id === selected.id)) return;
    closeScene();
    setGateSelectionNote("That crossing is no longer on the map.");
  }, [selected, gatesAuthoritative, loadingGates, sceneState, gatesCheckedAt, scene, gates, closeScene]);

  const historical = Boolean(predict?.offline || (checkedAt && now - checkedAt > ESTIMATE_WINDOW_MS));
  const sceneHistorical = Boolean(scene && (scene.offline || now > sceneFreshUntil(scene)));
  const checkedScenes = useMemo(() => Object.values(gateChecks)
    .map((check) => currentScene(check, now)!), [gateChecks, now]);
  const displayPredict = useMemo(() => withGateChecks(currentPrediction(predict, now), checkedScenes, gates), [predict, now, checkedScenes, gates]);
  const displayScene = useMemo(() => currentScene(scene, now), [scene, now]);
  const sceneLead = displayScene?.trains[0];
  const ready = isReady(scene) ? scene : null;
  const marked = useMemo(() => markGates(gates, historical ? null : displayPredict,
    historical || !displayPredict?.gate_predictions ? checkedScenes : null), [gates, displayPredict, historical, checkedScenes]);
  const run = useMemo(() => ready ? sceneRun(ready, sceneHistorical) : null, [ready, sceneHistorical]);
  const visibleTrains = run ? frameForRun(run, now).trains ?? [] : [];
  const visibleNumbers = new Set(visibleTrains.map(runKey));
  const visibleTrain = sceneLead && visibleTrains.find((train) => runKey(train) === runKey(sceneLead));
  const positionNote = displayScene?.awaiting_update?.length ? `${displayScene.awaiting_update.map((train) => train.number).join(" · ")} · position update needed` : visibleTrains.length > 1 ? `${visibleTrains.map((train) => train.number).join(" · ")} · estimated train positions and tracks` : !sceneLead ? null : sceneHistorical ? `${sceneLead.number} · saved crossing estimate · check trains to update`
    : sceneLead.observed === false ? `${sceneLead.number} · timetable only · current location unavailable`
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
          focusedTrain={focusedTrain}
          focusRequest={focusRequest}
          onFocusTrain={focusTrain}
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
        focusedTrain={focusedTrain}
        visibleTrains={visibleNumbers}
        onFocusTrain={focusTrain}
        onCloseGate={closeScene}
        onSaveGate={saveGate}
        gateCount={gates.length}
        loading={loadingGates}
        busy={checking || checkingCommute != null}
        checkingTrains={checking}
        error={error}
        note={gatesNote}
        gateSelectionNote={gateSelectionNote}
        gateVerified={Boolean(selected && gatesAuthoritative && gates.some((gate) => gate.id === selected.id))}
        onRetryGates={retryGates}
        predict={displayPredict}
        checkedAt={checkedAt}
        theme={theme}
        placeLabel={placeLabel}
        onCheck={() => void check()}
        favorites={favorites}
        onOpenSaved={openSaved}
        onRenameSaved={renameSaved}
        onRemoveSaved={removeSaved}
        commutes={commutes}
        commuteResults={commuteResults}
        checkingCommute={checkingCommute}
        pendingCommuteGates={pendingCommuteGates}
        commuteReadyAt={Math.max(commuteReadyAt, pausedUntil)}
        savedNotice={savedNotice}
        now={now}
        onSaveCommute={saveCommute}
        onRemoveCommute={removeCommute}
        onCheckCommute={checkCommute}
        refresh={refresh}
        onRefresh={setRefresh}
        paused={pausedUntil > now}
        historical={historical}
        gatesCached={gatesCached}
        onTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onSelect={openGate}
      />
      {pending ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="place-title"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
            const first = buttons[0], last = buttons[buttons.length - 1];
            const target = event.shiftKey ? document.activeElement === first ? last : null
              : document.activeElement === last ? first : null;
            if (target) { event.preventDefault(); target.focus(); }
          }}>
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
