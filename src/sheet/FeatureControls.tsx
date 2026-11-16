import { useEffect, useState } from "react";
import { fetchReports, submitReport, type Gate } from "../api";
import { gateLink, reportLabel, type RefreshSettings, type SavedGate } from "../features";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

export function SavedGates({ items, onOpen, onRename, onRemove }: {
  items: SavedGate[]; onOpen: (item: SavedGate) => void; onRename: (item: SavedGate) => void; onRemove: (id: string) => void;
}) {
  if (!items.length) return <div className="empty-state"><Icon name="saved" size={30} /><h3>Your regular crossings, together</h3><p>Open a crossing and save it as Home, Office, or a name you choose.</p></div>;
  return <section className="saved-gates" aria-label="Saved crossings">
    {items.map((item) => <div className="saved-card" key={item.gate.id}>
      <div className="saved-row">
        <button type="button" className="saved-open" onClick={() => onOpen(item)}><Icon name="saved" /><span><strong>{item.label}</strong><small>{item.gate.name || "Level crossing"}</small></span><Icon name="chevron" size={16} /></button>
        <details className="saved-menu"><summary aria-label={`Manage ${item.label}`}>•••</summary><div className="saved-menu-actions">
          <button type="button" onClick={() => onRename(item)}>Rename</button>
          <button type="button" onClick={() => onRemove(item.gate.id)}>Remove</button>
        </div></details>
      </div>
    </div>)}
    <p className="quiet">Saved on this device.</p>
  </section>;
}

export function RefreshControls({ settings, onChange, hasPlace, paused }: {
  settings: RefreshSettings; onChange: (value: RefreshSettings) => void; hasPlace: boolean; paused: boolean;
}) {
  const patch = (value: Partial<RefreshSettings>) => onChange({ ...settings, ...value });
  return <section className="refresh-controls" aria-label="Automatic checks">
    <label><input type="checkbox" checked={settings.enabled} disabled={!hasPlace} onChange={(e) => patch({ enabled: e.target.checked })} /> Check every 2 minutes while visible</label>
    {settings.enabled && <>
      <label><input type="checkbox" checked={settings.commute} onChange={(e) => patch({ commute: e.target.checked })} /> Only during my commute</label>
      {settings.commute && <div className="commute-times">
        <label>From <input type="time" value={settings.start} onChange={(e) => patch({ start: e.target.value })} /></label>
        <label>Until <input type="time" value={settings.end} onChange={(e) => patch({ end: e.target.value })} /></label>
        <label><input type="checkbox" checked={settings.weekdays} onChange={(e) => patch({ weekdays: e.target.checked })} /> Weekdays</label>
        <small>Uses this device’s local time.</small>
      </div>}
      {paused && <p className="quiet">Automatic checks are paused until the service allows another check.</p>}
    </>}
  </section>;
}

export function GateActions({ gate, saved, onSave }: { gate: Gate; saved: boolean; onSave: () => void }) {
  const [message, setMessage] = useState("");
  const [reports, setReports] = useState<{ state: string; at: number; expires_at: number }[]>([]);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setReports([]); setMessage("");
    const load = () => fetchReports(gate.id).then((body) => { if (active) setReports(body.reports); }).catch(() => {});
    void load();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void load(); }, 45000);
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(poll); };
  }, [gate.id]);
  async function share() {
    const url = gateLink(gate);
    try {
      if (navigator.share) await navigator.share({ title: gate.name || "GateAhead crossing", url });
      else { await navigator.clipboard.writeText(url); setMessage("Crossing link copied."); }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessage(url);
    }
  }
  async function report(state: string) {
    setSending(true);
    try { const body = await submitReport(gate, state); setReports(body.reports); setNow(Date.now()); setMessage("Report saved for 10 minutes."); setReportOpen(false); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Could not send your report."); }
    finally { setSending(false); }
  }
  const recent = reports.filter((row) => row.expires_at * 1000 > now);
  return <div className="gate-actions">
    <div className="actions crossing-actions">
      <button type="button" className="ghost" onClick={onSave}><Icon name="saved" size={17} />{saved ? "Saved · remove" : "Save gate"}</button>
      <button type="button" className="ghost" onClick={share}>Share</button>
      <button type="button" className="ghost" onClick={() => setReportOpen(true)} aria-haspopup="dialog">Report</button>
    </div>
    <details className="disclosure community-reports">
      <summary>Community reports{recent.length ? ` (${recent.length})` : ""}</summary>
      {recent.length ? recent.slice(0, 3).map((row, i) => <p key={`${row.at}-${i}`}>{reportLabel(row.state)} · {Math.max(0, Math.floor((now / 1000 - row.at) / 60))} min ago</p>) : <p className="quiet">No recent reports for this crossing.</p>}
      <p className="quiet">Unverified · expire after 10 minutes.</p>
    </details>
    {message && <p className="quiet" role="status">{message}</p>}
    {reportOpen && <Dialog title="Report this crossing" onClose={() => setReportOpen(false)}>
      <p className="quiet">{gate.name || "Level crossing"} · what can you see right now?</p>
      <div className="report-choices">{[["open", "The gate is open"], ["closed", "The gate is closed"], ["wrong_location", "The location is incorrect"]].map(([state, label]) =>
        <button type="button" className="ghost" key={state} disabled={sending} onClick={() => report(state)}>{label}<Icon name="chevron" size={16} /></button>)}</div>
      <p className="quiet">Reports are unverified and expire after 10 minutes.</p>
      {sending && <p className="quiet" role="status">Sending report…</p>}
      {message && <p className="quiet" role="status">{message}</p>}
    </Dialog>}
  </div>;
}
