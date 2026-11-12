import { useEffect, useState, type KeyboardEvent } from "react";

import { fetchCities, type City } from "../api";

type Props = {
  onPick: (city: City) => void;
};

export function CitySearch({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setNote(null);
      setFailed(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetchCities(trimmed, ctrl.signal)
        .then((cities) => {
          setResults(cities);
          setActive(0);
          setFailed(false);
          setNote(cities.length === 0 ? "No Indian city matches that." : null);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setResults([]);
          setFailed(true);
          setNote("City search did not load.");
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function pick(city: City) {
    setQuery("");
    setResults([]);
    setNote(null);
    onPick(city);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      setResults([]);
      setNote(null);
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
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
        role="combobox"
        aria-label="Search an Indian city"
        aria-expanded={results.length > 0}
        aria-controls="city-results"
        aria-autocomplete="list"
        placeholder="Search an Indian city"
        value={query}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {results.length > 0 ? (
        <ul id="city-results" role="listbox">
          {results.map((city, index) => (
            <li key={`${city.name}-${city.state}`}>
              <button
                type="button"
                role="option"
                id={`city-${index}`}
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
      {note ? <p className={failed ? "warn" : "quiet"}>{note}</p> : null}
    </div>
  );
}
