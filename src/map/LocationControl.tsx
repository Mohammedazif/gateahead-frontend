import { useState } from "react";
import type { City } from "../api";
import { CitySearch } from "../sheet/CitySearch";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

export function LocationControl({ label, locating, onCity, onLocate }: {
  label: string | null; locating: boolean; onCity: (city: City) => void; onLocate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="map-location" aria-label="Search area">
      <button type="button" className="location-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="search" /><span>{label || "Choose a place"}</span><Icon name="chevron" size={16} />
      </button>
      <button type="button" className="icon-button" aria-label={locating ? "Finding your location" : "Use my location"} disabled={locating} onClick={onLocate}><Icon name="locate" /></button>
    </div>
    {open && <Dialog title="Find a crossing" onClose={() => setOpen(false)}>
      <p className="quiet">Search a city, use your location, or tap a point on the map.</p>
      <CitySearch autoFocus onPick={(city) => { onCity(city); setOpen(false); }} />
      <button type="button" className="ghost location-choice" disabled={locating} onClick={() => { setOpen(false); onLocate(); }}><Icon name="locate" />Use my location</button>
    </Dialog>}
  </>;
}
