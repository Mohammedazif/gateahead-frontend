export type Gate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  km: number;
  source: string;
  status?: string;
  eta?: number;
};

export type Approach = {
  train: string;
  name: string;
  cluster: string;
  count: number;
  eta: number;
  status: string;
  at_station: boolean;
  current: string;
  from_you_km: number;
  lat: number;
  lon: number;
  ids?: string[];
  bracket?: string;
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

export type Sighting = {
  number: string;
  name: string;
  current: string;
  delay: number;
  age: number;
  eta: number | null;
  passed_local: boolean;
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
};

export type Predict = {
  error?: string;
  crossings: number;
  stations: string[];
  checked: number;
  running: number;
  approaching: Approach[];
  sightings: Sighting[];
};

export type SceneTrain = {
  number: string;
  name: string;
  eta_min: number;
  status: string;
  along_km: number;
  age_min: number;
  bracket?: string;
};

export type Scene = {
  available: boolean;
  error?: string;
  crossing?: { id: string; name: string; lat: number; lon: number };
  rail: [number, number][];
  trains: SceneTrain[];
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (response.status === 429) {
    throw new Error("Too many checks. Wait a few minutes and try again.");
  }
  if (!response.ok) {
    throw new Error("Could not reach the service. Try again in a moment.");
  }
  return response.json() as Promise<T>;
}

export type City = {
  name: string;
  state: string;
  lat: number;
  lon: number;
};

export function fetchCities(query: string, signal?: AbortSignal): Promise<City[]> {
  return getJson<{ cities?: City[] }>(`/api/cities?q=${encodeURIComponent(query)}`, signal).then(
    (body) => body.cities ?? [],
  );
}

export function fetchPlaceName(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<{ name: string | null }> {
  return getJson(`/api/place?lat=${lat}&lon=${lon}`, signal);
}

export function fetchGates(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<{ gates: Gate[]; error?: string }> {
  return getJson(`/api/gates?lat=${lat}&lon=${lon}`, signal);
}

export function fetchPredict(lat: number, lon: number, signal?: AbortSignal): Promise<Predict> {
  return getJson(`/api/predict?lat=${lat}&lon=${lon}`, signal);
}

export function fetchScene(lat: number, lon: number, crossingId: string, signal?: AbortSignal): Promise<Scene> {
  const id = encodeURIComponent(crossingId);
  return getJson(`/api/scene?lat=${lat}&lon=${lon}&crossing_id=${id}`, signal);
}

export function friendlyError(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again in a moment.";
  if (/429|502|504|timeout|timed out|busy|map_busy/i.test(message)) {
    return "The crossing list is busy. Wait a minute and try again.";
  }
  if (/406|overpass|map_unavailable|could not reach|invalid data/i.test(message)) {
    return "The crossing list did not load. Try again in a minute.";
  }
  if (message === "crossing_not_found") return "That crossing is no longer on the map.";
  return message;
}
