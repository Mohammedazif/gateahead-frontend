import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { fetchCities, RequestError, type City } from "../api";

type Props = {
  onPick: (city: City) => void;
  autoFocus?: boolean;
};

export function CitySearch({ onPick, autoFocus = false }: Props) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{ query: string; cities: City[] } | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const results = response?.query === query.trim() ? response.cities : [];
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResponse(null);
      setNote(null);
      setFailed(false);
      return;
    }
    // Results belong to the query that produced them. Enter must not select
    // an old city while the replacement query is still waiting to load.
    setResponse(null);
    setActive(-1);
    setNote(null);
    setFailed(false);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetchCities(trimmed, ctrl.signal)
        .then((cities) => {
          if (ctrl.signal.aborted) return;
          setResponse({ query: trimmed, cities });
          setActive(-1);
          setFailed(false);
          setNote(cities.length === 0 ? "No Indian city matches that." : null);
        })
        .catch((error: unknown) => {
          if (ctrl.signal.aborted) return;
          setResponse(null);
          setFailed(true);
          setNote(error instanceof RequestError && error.retryAt ? error.message : "City search did not load. Try again.");
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function pick(city: City) {
    setQuery("");
    setResponse(null);
    setNote(null);
    onPick(city);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      if (!query) return;
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      setResponse(null);
      setNote(null);
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => index < 0 ? results.length - 1 : (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const city = results[active] ?? results[0];
      if (city) pick(city);
    }
  }

  return (
    <div className="city-search">
      <input
        type="search"
        autoFocus={autoFocus}
        role="combobox"
        aria-label="Search an Indian city"
        aria-expanded={results.length > 0}
        aria-controls={results.length ? listId : undefined}
        aria-activedescendant={active >= 0 && active < results.length ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="Search an Indian city"
        value={query}
        autoComplete="off"
        onChange={(event) => { setQuery(event.target.value); setNote(null); setActive(-1); }}
        onKeyDown={onKeyDown}
      />
      {results.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Matching cities">
          {results.map((city, index) => (
            <li key={`${city.name}-${city.state}-${city.lat}-${city.lon}`} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                tabIndex={-1}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(city)}
              >
                <span>{city.name}</span>
                <span>{city.state}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={failed ? "warn" : "quiet"} role="status">{note}</p>
    </div>
  );
}
