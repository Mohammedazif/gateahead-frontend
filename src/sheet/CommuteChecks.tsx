import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { Gate } from "../api";
import { MAX_COMMUTE_GATES, MAX_COMMUTES, type Commute, type CommuteResult } from "../commute";
import { incompleteCheck, type SavedGate } from "../features";
import { trackCrossingLabel } from "../gateGroups";
import { sceneTimingLabel } from "../labels";
import { currentScene, sceneFreshUntil } from "../timing";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { checkedAgo } from "./checked";

type Props = {
  commutes: Commute[];
  favorites: SavedGate[];
  gates: Gate[];
  results: Record<string, CommuteResult>;
  checking: string | null;
  pendingGateIds: string[];
  busy: boolean;
  readyAt: number;
  now: number;
  onSave: (commute: Commute) => boolean;
  onRemove: (id: string) => boolean;
  onCheck: (commute: Commute) => void;
  onOpenGate: (gate: SavedGate) => void;
};

export function CommuteChecks({ commutes, favorites, gates, results, checking, pendingGateIds,
  busy, readyAt, now, onSave, onRemove, onCheck, onOpenGate }: Props) {
  const [editing, setEditing] = useState<Commute | null>(null);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const menuButtons = useRef(new Map<string, HTMLElement>());
  const moveFocus = useRef<{ target?: string } | null>(null);
  const favoriteById = new Map(favorites.map((favorite) => [favorite.gate.id, favorite]));
  const knownGates = [...new Map([...favorites.map(({ gate }) => gate), ...gates].map((gate) => [gate.id, gate])).values()];
  const waiting = now < readyAt;
  const checked = useRef(checking);
  const pendingGates = new Set(pendingGateIds);

  useLayoutEffect(() => {
    const move = moveFocus.current;
    if (!move) return;
    moveFocus.current = null;
    (move.target ? menuButtons.current.get(move.target) ?? newButton.current ?? heading.current
      : newButton.current ?? heading.current)?.focus();
  }, [commutes]);

  useLayoutEffect(() => {
    if (checking === checked.current) return;
    if (checking) setNotice("Checking commute crossings.");
    else setNotice((previous) => previous === "Checking commute crossings." ? "Commute check finished." : previous);
    checked.current = checking;
  }, [checking]);

  function removeTrip(id: string, index: number) {
    if (!onRemove(id)) {
      setNotice("Could not remove this commute from this device.");
      return;
    }
    moveFocus.current = { target: (commutes[index + 1] ?? commutes[index - 1])?.id };
    setNotice("Commute removed.");
  }

  if (!favorites.length) return null;
  return <section className="commute-checks" aria-labelledby="commute-heading">
    <div className="content-heading">
      <h2 ref={heading} id="commute-heading" tabIndex={-1}>Commute Check</h2>
      {commutes.length < MAX_COMMUTES && <button ref={newButton} type="button" className="text-button" aria-haspopup="dialog"
        onClick={() => setEditing({ id: "", label: "", gateIds: [] })}>New commute</button>}
    </div>
    <p className="quiet control-feedback" role="status" aria-atomic="true">{notice}</p>
    {!commutes.length && <p className="section-caption">Group saved crossings into a trip and check them before leaving.</p>}
    {waiting && !busy && <p className="quiet">Next check available at {new Date(readyAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}.</p>}
    {commutes.map((commute, index) => {
      const stops = commute.gateIds.flatMap((id) => favoriteById.get(id) ?? []);
      const unavailable = busy || waiting || !stops.length;
      return <section className="saved-card commute-card" key={commute.id} aria-label={commute.label}>
        <div className="content-heading"><h3>{commute.label}</h3>
          <details className="saved-menu"><summary ref={(element) => {
            if (element) menuButtons.current.set(commute.id, element);
            else menuButtons.current.delete(commute.id);
          }} aria-label={`Manage ${commute.label}`}>•••</summary>
            <div className="saved-menu-actions">
              <button type="button" aria-haspopup="dialog" onClick={() => setEditing(commute)}>Edit</button>
              <button type="button" onClick={() => removeTrip(commute.id, index)}>Remove</button>
            </div>
          </details>
        </div>
        {stops.length ? <ol className="commute-stops">{stops.map((stop) => {
          const scope = trackCrossingLabel(stop.gate.id, knownGates);
          return <li key={stop.gate.id}>
            <button type="button" className="crossing-member" onClick={() => onOpenGate(stop)}>
              <strong>{stop.label}</strong><Icon name="chevron" size={16} />
            </button>
            {scope && <p className="quiet">{scope} · this check covers one track.</p>}
            <CommuteGateTiming result={results[stop.gate.id]} checking={checking === commute.id && pendingGates.has(stop.gate.id)} now={now} />
          </li>;
        })}</ol> : <p className="quiet">Add a saved crossing to check this trip.</p>}
        <button type="button" className="solid compact" aria-disabled={unavailable} onClick={() => { if (!unavailable) onCheck(commute); }}>
          {checking === commute.id ? "Checking…" : "Check commute"}
        </button>
      </section>;
    })}
    {editing && <CommuteEditor commute={editing} favorites={favorites} onClose={() => setEditing(null)} onSave={(commute) => {
      if (!onSave(commute)) return false;
      setNotice("Commute saved.");
      setEditing(null);
      return true;
    }} />}
  </section>;
}

function CommuteGateTiming({ result, checking, now }: { result?: CommuteResult; checking: boolean; now: number }) {
  if (!result?.scene) return <p className="quiet">{checking ? "Checking this crossing…" : result?.error ?? "Ready to check"}</p>;
  const { scene } = result;
  const historical = scene.offline || now > sceneFreshUntil(scene);
  const display = historical ? scene : currentScene(scene, now)!;
  const train = display.available ? [...display.trains].sort((a, b) => a.eta_min - b.eta_min)[0] : undefined;
  const partial = incompleteCheck(display);
  const needsUpdate = [...new Set(display.awaiting_update?.map((row) => row.number))];
  return <div className="commute-timing">
    {checking && <p className="quiet">Checking this crossing…</p>}
    {result.error && !checking && <p className="quiet">{result.error}</p>}
    {train ? <>
      <p>{train.number} {train.name} · {sceneTimingLabel(train, historical)}</p>
      <p className="quiet">{train.observed === false ? "Current position unavailable" : train.movement === "stopped"
        ? (historical ? "The train was reported stopped at the saved check" : "The train was reported stopped")
        : "Train report estimate"}{partial ? " · incomplete check" : ""}</p>
    </> : <p>{!display.available || partial ? (historical ? "Train timing was unavailable at the saved check" : "Train timing unavailable")
      : !needsUpdate.length ? (historical ? "The saved check found no approaching train on this track" : "No approaching train found on this track") : null}</p>}
    {needsUpdate.length > 0 && <p className="quiet">{historical ? "Position update was needed at the saved check" : "Position update needed"} · {needsUpdate.join(", ")}</p>}
    {!train && <p className="quiet">The barrier’s position is unknown.</p>}
    {scene.cached_at && <p className="quiet">{historical ? `Saved check · ${new Date(scene.cached_at).toLocaleString()}` : checkedAgo(scene.cached_at, now)}</p>}
  </div>;
}

function CommuteEditor({ commute, favorites, onClose, onSave }: { commute: Commute; favorites: SavedGate[];
  onClose: () => void; onSave: (commute: Commute) => boolean }) {
  const savedById = new Map(favorites.map((favorite) => [favorite.gate.id, favorite]));
  const [label, setLabel] = useState(commute.label);
  const [gateIds, setGateIds] = useState(() => commute.gateIds.filter((id) => savedById.has(id)));
  const [notice, setNotice] = useState("");
  const reorderFocus = useRef<{ id: string; direction: "earlier" | "later" } | null>(null);
  const arrows = useRef(new Map<string, HTMLButtonElement>());

  useLayoutEffect(() => {
    const move = reorderFocus.current;
    if (!move) return;
    reorderFocus.current = null;
    const same = arrows.current.get(`${move.id}:${move.direction}`);
    const other = arrows.current.get(`${move.id}:${move.direction === "earlier" ? "later" : "earlier"}`);
    (same?.disabled ? other : same)?.focus();
  }, [gateIds]);

  function move(index: number, offset: number) {
    const id = gateIds[index];
    reorderFocus.current = { id, direction: offset < 0 ? "earlier" : "later" };
    setNotice(`${savedById.get(id)?.label ?? "Crossing"} moved to stop ${index + offset + 1}.`);
    setGateIds((ids) => {
      const ordered = [...ids];
      const [id] = ordered.splice(index, 1);
      ordered.splice(index + offset, 0, id);
      return ordered;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stops = gateIds.filter((id) => savedById.has(id));
    if (!label.trim() || !stops.length) return;
    if (!onSave({ id: commute.id || crypto.randomUUID(), label: label.trim(), gateIds: stops })) {
      setNotice("Could not save this commute on this device. Try again.");
    }
  }
  return <Dialog title={commute.id ? "Edit commute" : "New commute"} onClose={onClose}>
    <form className="commute-editor" onSubmit={submit}>
      <label className="commute-name">Commute name<input value={label} maxLength={80} placeholder="Home to work" onChange={(event) => setLabel(event.target.value)} required /></label>
      <fieldset className="refresh-controls">
        <legend>Saved crossings</legend>
        {favorites.map((favorite) => {
          const id = favorite.gate.id;
          const checked = gateIds.includes(id);
          return <label key={id}><input type="checkbox" checked={checked} disabled={!checked && gateIds.length >= MAX_COMMUTE_GATES}
            onChange={() => setGateIds((ids) => checked ? ids.filter((gateId) => gateId !== id) : [...ids, id])} />{favorite.label}</label>;
        })}
        {gateIds.length >= MAX_COMMUTE_GATES && <small>Choose up to {MAX_COMMUTE_GATES} crossings per commute.</small>}
      </fieldset>
      {gateIds.length > 1 && <fieldset>
        <legend>Travel order</legend>
        <ol className="commute-order">{gateIds.map((id, index) => {
          const name = savedById.get(id)?.label ?? "Removed saved crossing";
          return <li key={id}><div><span>{name}</span><div className="actions">
            <button ref={(element) => { if (element) arrows.current.set(`${id}:earlier`, element); else arrows.current.delete(`${id}:earlier`); }}
              type="button" className="ghost compact" disabled={index === 0} aria-label={`Move ${name} earlier`} onClick={() => move(index, -1)}>↑</button>
            <button ref={(element) => { if (element) arrows.current.set(`${id}:later`, element); else arrows.current.delete(`${id}:later`); }}
              type="button" className="ghost compact" disabled={index === gateIds.length - 1} aria-label={`Move ${name} later`} onClick={() => move(index, 1)}>↓</button>
          </div></div></li>;
        })}</ol>
      </fieldset>}
      <p className="quiet control-feedback" role="status" aria-atomic="true">{notice}</p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="solid" disabled={!label.trim() || !gateIds.length}>Save commute</button>
      </div>
    </form>
  </Dialog>;
}
