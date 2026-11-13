import { useEffect, useRef } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import maplibregl from "maplibre-gl";

import type { Gate } from "../api";
import indiaOutline from "./india_outline.geojson";
import railNetwork from "./india_rail.geojson";
import { frameAt, metresBetween, PLAY_SECONDS, type LngLat, type MapRun, type RunFrame } from "./playback";
import { trainImage } from "./trainSprite";
import { MAP_STYLE, type Theme } from "../theme";

const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [68.17, 6.75],
  [97.34, 35.5],
];

type Spot = { lat: number; lon: number };

type Props = {
  place: Spot | null;
  pending: Spot | null;
  gates: Gate[];
  selectedId: string | null;
  run: MapRun | null;
  theme: Theme;
  onPlace: (lat: number, lon: number, point: { x: number; y: number }) => void;
  onSelect: (gate: Gate) => void;
};

type GateProbe = Window & {
  __gateRun?: { clearance: number; acrossRoad: number; lowered: number; train: { lat: number; lon: number } | null };
};

export function MapView({ place, pending, gates, selectedId, run, theme, onPlace, onSelect }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const gatesRef = useRef(gates);
  const placeRef = useRef(place);
  const pendingRef = useRef(pending);
  const selectedRef = useRef(selectedId);
  const onPlaceRef = useRef(onPlace);
  const onSelectRef = useRef(onSelect);
  const railRef = useRef<[number, number][] | null>(null);
  const frameRef = useRef<RunFrame | null>(null);
  const themeRef = useRef(theme);
  const styleRef = useRef(MAP_STYLE[theme]);
  themeRef.current = theme;
  gatesRef.current = gates;
  placeRef.current = place;
  pendingRef.current = pending;
  selectedRef.current = selectedId;
  onPlaceRef.current = onPlace;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const node = holder.current;
    if (!node || mapRef.current) return;
    const map = new maplibregl.Map({
      container: node,
      style: styleRef.current,
      center: [79.6, 22.5],
      zoom: 4.3,
      minZoom: 3.2,
      attributionControl: false,
    });
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(node);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("styleimagemissing", (event) => {
      if (map.hasImage(event.id)) return;
      map.addImage(event.id, fallbackSprite(event.id));
    });
    let booted = false;
    const installOverlays = () => {
      installNetwork(map);
      if (!map.getSource("gates")) {
        map.addSource("gates", { type: "geojson", data: emptyCollection() });
        map.addLayer({
          id: "gates",
          type: "circle",
          source: "gates",
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "selected"], 1],
              8,
              ["in", ["get", "status"], ["literal", ["closed", "closing_soon", "approaching"]]],
              7.5,
              5.5,
            ],
            "circle-color": ["match", ["get", "status"], "closed", "#c4382f", "closing_soon", "#e07a2f", "#e7a23a"],
            "circle-stroke-width": [
              "case",
              ["==", ["get", "selected"], 1],
              3,
              ["in", ["get", "status"], ["literal", ["closed", "closing_soon"]]],
              2,
              1.5,
            ],
            "circle-stroke-color": "#f7f1e6",
          },
        });
        map.on("mouseenter", "gates", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "gates", () => {
          map.getCanvas().style.cursor = "";
        });
      }
      if (!map.getSource("you")) {
        map.addSource("you", { type: "geojson", data: emptyCollection() });
        map.addLayer({
          id: "you",
          type: "circle",
          source: "you",
          paint: {
            "circle-radius": 6,
            "circle-color": "#f4efe6",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#c4382f",
          },
        });
      }
      if (!map.getSource("pending")) {
        map.addSource("pending", { type: "geojson", data: emptyCollection() });
        map.addLayer({
          id: "pending",
          type: "circle",
          source: "pending",
          paint: {
            "circle-radius": 12,
            "circle-color": "#e7a23a",
            "circle-opacity": 0,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#e7a23a",
          },
        });
      }
      if (!map.getSource("play-rail")) {
        if (!map.hasImage("train")) map.addImage("train", trainImage(), { pixelRatio: 2 });
        map.addSource("play-rail", { type: "geojson", data: emptyCollection() });
        map.addSource("play-road", { type: "geojson", data: emptyCollection() });
        map.addSource("play-bars", { type: "geojson", data: emptyCollection() });
        map.addSource("play-posts", { type: "geojson", data: emptyCollection() });
        map.addSource("play-train", { type: "geojson", data: emptyCollection() });
        map.addLayer({
          id: "play-road",
          type: "line",
          source: "play-road",
          paint: { "line-color": "#8d7962", "line-width": 12, "line-opacity": 0.95 },
          layout: { "line-cap": "butt" },
        });
        map.addLayer({
          id: "play-rail",
          type: "line",
          source: "play-rail",
          paint: { "line-color": "#e7a23a", "line-width": 3.5, "line-opacity": 0.95 },
          layout: { "line-cap": "round" },
        });
        map.addLayer({
          id: "play-bars-casing",
          type: "line",
          source: "play-bars",
          paint: { "line-color": "#f4efe6", "line-width": 8 },
          layout: { "line-cap": "butt" },
        });
        map.addLayer({
          id: "play-bars",
          type: "line",
          source: "play-bars",
          paint: { "line-color": "#c4382f", "line-width": 4.5, "line-dasharray": [1.15, 0.85] },
          layout: { "line-cap": "butt" },
        });
        map.addLayer({
          id: "play-posts",
          type: "circle",
          source: "play-posts",
          paint: {
            "circle-radius": 4.5,
            "circle-color": "#f7f1e6",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#c4382f",
          },
        });
        map.addLayer({
          id: "play-train",
          type: "symbol",
          source: "play-train",
          layout: {
            "icon-image": "train",
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.55, 17, 0.85, 18.5, 1.05],
          },
        });
      }
      applyGates(map, gatesRef.current, selectedRef.current);
      applyPending(map, pendingRef.current);
      applyYou(map, placeRef.current);
      applyThemePaint(map, themeRef.current);
      if (railRef.current && frameRef.current) paintPlay(map, railRef.current, frameRef.current);
      else if (!booted) {
        showPlace(map, placeRef.current, gatesRef.current);
        if (!placeRef.current) frameIndia(map);
      }
      booted = true;
    };
    map.on("load", installOverlays);
    map.on("style.load", installOverlays);
    map.on("webglcontextrestored", installOverlays);
    map.on("click", (event) => {
      const layers = ["gates", "play-train", "play-bars", "play-road"].filter((id) => map.getLayer(id));
      if (layers.length > 0) {
        const hits = map.queryRenderedFeatures(event.point, { layers });
        const gateHit = hits.find((hit) => hit.layer.id === "gates");
        if (gateHit) {
          const id = String(gateHit.properties?.id ?? "");
          const gate = gatesRef.current.find((item) => item.id === id);
          if (gate) onSelectRef.current(gate);
          return;
        }
        if (hits.length > 0) return;
      }
      const rect = map.getCanvas().getBoundingClientRect();
      onPlaceRef.current(event.lngLat.lat, event.lngLat.lng, {
        x: rect.left + event.point.x,
        y: rect.top + event.point.y,
      });
    });
    mapRef.current = map;
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const next = MAP_STYLE[theme];
    if (!map) return;
    if (styleRef.current === next) {
      applyThemePaint(map, theme);
      return;
    }
    styleRef.current = next;
    map.setStyle(next, { diff: false });
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => applyGates(map, gates, selectedId);
    if (map.getSource("gates")) apply();
    else map.once("load", apply);
  }, [gates, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => applyPending(map, pending);
    if (map.getSource("pending")) apply();
    else map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [pending]);

  useEffect(() => {
    const map = mapRef.current;
    const placeNow = placeRef.current;
    if (!map || !placeNow || gates.length === 0) return;
    const fit = () => {
      if (!map.getSource("gates") || railRef.current) return;
      fitCrossings(map, placeNow, gates);
    };
    if (map.isStyleLoaded() && map.getSource("gates")) fit();
    else map.once("load", fit);
    return () => {
      map.off("load", fit);
    };
  }, [gates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!run) {
      railRef.current = null;
      frameRef.current = null;
      const clear = () => {
        clearPlay(map);
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      };
      if (map.getSource("play-rail")) clear();
      else map.once("load", clear);
      return () => {
        map.off("load", clear);
      };
    }
    railRef.current = run.rail;
    const hold = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let raf = 0;
    let follow = true;
    const stopFollow = () => {
      follow = false;
    };
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000;
      const frame = frameAt(run.rail, run.crossing, run.train, elapsed, hold);
      frameRef.current = frame;
      paintPlay(map, run.rail, frame);
      const spot = frame.train && metresBetween(frame.train, run.crossing) > 280 ? frame.train : run.crossing;
      if (follow) map.jumpTo({ center: [spot.lon, spot.lat], zoom: 17.15 });
      if (import.meta.env.DEV) {
        (window as GateProbe).__gateRun = {
          clearance: frame.clearance,
          acrossRoad: frame.acrossRoad,
          lowered: frame.lowered,
          train: frame.train ? { lat: frame.train.lat, lon: frame.train.lon } : null,
        };
      }
      if (!hold && elapsed < PLAY_SECONDS) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!map.getSource("play-rail")) return;
      map.setPadding({ top: 56, bottom: 28, left: 40, right: 48 });
      tick();
    };
    map.on("dragstart", stopFollow);
    map.on("wheel", stopFollow);
    if (map.getSource("play-rail")) start();
    else map.once("load", start);
    return () => {
      cancelAnimationFrame(raf);
      map.off("dragstart", stopFollow);
      map.off("wheel", stopFollow);
      map.off("load", start);
    };
  }, [run]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !place) return;
    let flew = false;
    const go = () => {
      if (flew || !map.getSource("you")) return;
      flew = true;
      showPlace(map, place, gatesRef.current);
    };
    go();
    map.on("load", go);
    map.on("idle", go);
    return () => {
      flew = true;
      map.off("load", go);
      map.off("idle", go);
    };
  }, [place]);

  return <div ref={holder} className="map" />;
}

function applyThemePaint(map: maplibregl.Map, theme: Theme) {
  const light = theme === "light";
  const ink = light ? "#241910" : "#f7f1e6";
  const paper = light ? "#fffaf3" : "#f4efe6";
  const rail = light ? "#b86a12" : "#e7a23a";
  if (map.getLayer("gates")) map.setPaintProperty("gates", "circle-stroke-color", ink);
  if (map.getLayer("you")) map.setPaintProperty("you", "circle-color", ink);
  if (map.getLayer("play-road")) map.setPaintProperty("play-road", "line-color", light ? "#8a6240" : "#8d7962");
  if (map.getLayer("play-rail")) map.setPaintProperty("play-rail", "line-color", rail);
  if (map.getLayer("play-bars-casing")) map.setPaintProperty("play-bars-casing", "line-color", paper);
  if (map.getLayer("play-posts")) map.setPaintProperty("play-posts", "circle-color", paper);
  if (map.getLayer("india-outline")) {
    map.setPaintProperty("india-outline", "line-color", light ? "#8a4e0d" : "#e7c89a");
    map.setPaintProperty("india-outline", "line-opacity", light ? 0.55 : 0.72);
  }
  if (map.getLayer("india-rail-glow")) {
    map.setPaintProperty("india-rail-glow", "line-color", rail);
    map.setPaintProperty("india-rail-glow", "line-opacity", light ? 0.22 : 0.42);
  }
  if (map.getLayer("india-rail")) map.setPaintProperty("india-rail", "line-color", rail);
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!layer.id.startsWith("railway") || layer.type !== "line") continue;
    if (layer.id.includes("dash")) {
      map.setLayoutProperty(layer.id, "visibility", "none");
      continue;
    }
    map.setLayerZoomRange(layer.id, 7, 24);
    map.setPaintProperty(layer.id, "line-color", rail);
    map.setPaintProperty(layer.id, "line-width", ["interpolate", ["linear"], ["zoom"], 7, 1.6, 12, 3, 16, 5]);
    map.setLayoutProperty(layer.id, "line-cap", "round");
    map.setLayoutProperty(layer.id, "line-join", "round");
  }
}

function frameIndia(map: maplibregl.Map) {
  const camera = map.cameraForBounds(INDIA_BOUNDS, {
    padding: { top: 36, right: 64, bottom: 28, left: 28 },
  });
  if (!camera || camera.zoom == null) return;
  map.jumpTo({ center: camera.center, zoom: Math.max(camera.zoom, 4.15) });
}

function installNetwork(map: maplibregl.Map) {
  if (map.getSource("india-rail")) return;
  map.addSource("india-outline", { type: "geojson", data: indiaOutline });
  map.addSource("india-rail", { type: "geojson", data: railNetwork });
  map.addLayer({
    id: "india-outline",
    type: "line",
    source: "india-outline",
    maxzoom: 9,
    paint: { "line-color": "#e7c89a", "line-width": 1.25, "line-opacity": 0.72 },
  });
  map.addLayer({
    id: "india-rail-glow",
    type: "line",
    source: "india-rail",
    maxzoom: 10,
    paint: {
      "line-color": "#e7a23a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 8, 9, 12],
      "line-opacity": 0.42,
      "line-blur": 1.2,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "india-rail",
    type: "line",
    source: "india-rail",
    maxzoom: 10,
    paint: {
      "line-color": "#e7a23a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.6, 5, 2.4, 8, 3.4],
      "line-opacity": 0.95,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
}

function fallbackSprite(id: string): { width: number; height: number; data: Uint8Array } {
  const size = id === "circle-11" ? 16 : 8;
  const data = new Uint8Array(size * size * 4);
  if (id !== "circle-11") {
    data.fill(255);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 32;
      data[i + 1] = 32;
      data[i + 2] = 32;
    }
    return { width: size, height: size, data };
  }
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (Math.hypot(x - center + 0.5, y - center + 0.5) > 3.2) continue;
      const index = (y * size + x) * 4;
      data[index] = 196;
      data[index + 1] = 196;
      data[index + 2] = 196;
      data[index + 3] = 220;
    }
  }
  return { width: size, height: size, data };
}

function applyGates(map: maplibregl.Map, gates: Gate[], selectedId: string | null) {
  const source = map.getSource("gates") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: "FeatureCollection",
    features: gates.map((gate) => ({
      type: "Feature",
      properties: { id: gate.id, selected: gate.id === selectedId ? 1 : 0, status: gate.status ?? "" },
      geometry: { type: "Point", coordinates: [gate.lon, gate.lat] },
    })),
  });
}

function fitCrossings(map: maplibregl.Map, place: { lat: number; lon: number }, gates: Gate[]) {
  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([place.lon, place.lat]);
  for (const gate of gates) bounds.extend([gate.lon, gate.lat]);
  map.fitBounds(bounds, { padding: 56, maxZoom: 14.6, duration: 700 });
}

function showPlace(map: maplibregl.Map, place: { lat: number; lon: number } | null, gates: Gate[]) {
  applyYou(map, place);
  if (!place) return;
  if (gates.length > 0) {
    fitCrossings(map, place, gates);
    return;
  }
  const zoom = Math.max(map.getZoom(), 13.4);
  map.flyTo({ center: [place.lon, place.lat], zoom, essential: true });
  if (import.meta.env.DEV) (window as Window & { __mapZoom?: number }).__mapZoom = zoom;
}

function paintPlay(map: maplibregl.Map, rail: [number, number][], frame: RunFrame) {
  const railSource = map.getSource("play-rail") as maplibregl.GeoJSONSource | undefined;
  const roadSource = map.getSource("play-road") as maplibregl.GeoJSONSource | undefined;
  const barSource = map.getSource("play-bars") as maplibregl.GeoJSONSource | undefined;
  const postSource = map.getSource("play-posts") as maplibregl.GeoJSONSource | undefined;
  const trainSource = map.getSource("play-train") as maplibregl.GeoJSONSource | undefined;
  if (!railSource || !roadSource || !barSource || !postSource || !trainSource) return;
  railSource.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: rail.map(([lat, lon]) => [lon, lat]) },
      },
    ],
  });
  roadSource.setData(frame.road.length ? lineCollection(frame.road) : emptyCollection());
  barSource.setData(lineCollection(frame.barriers));
  postSource.setData({
    type: "FeatureCollection",
    features: frame.posts.map((post) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [post.lon, post.lat] },
    })),
  });
  trainSource.setData({
    type: "FeatureCollection",
    features: frame.train
      ? [
          {
            type: "Feature",
            properties: { bearing: frame.train.bearing },
            geometry: { type: "Point", coordinates: [frame.train.lon, frame.train.lat] },
          },
        ]
      : [],
  });
}

function lineCollection(lines: [LngLat, LngLat][]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map(([a, b]) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    })),
  };
}

function clearPlay(map: maplibregl.Map) {
  for (const id of ["play-rail", "play-road", "play-bars", "play-posts", "play-train"]) {
    const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    source?.setData(emptyCollection());
  }
  if (import.meta.env.DEV) delete (window as GateProbe).__gateRun;
}

function applyPending(map: maplibregl.Map, spot: Spot | null) {
  const source = map.getSource("pending") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData(spotCollection(spot));
}

function applyYou(map: maplibregl.Map, place: Spot | null) {
  const source = map.getSource("you") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData(spotCollection(place));
}

function spotCollection(spot: Spot | null): FeatureCollection<Point> {
  const features: Feature<Point>[] = spot
    ? [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [spot.lon, spot.lat] },
        },
      ]
    : [];
  return { type: "FeatureCollection", features };
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
