import { useEffect, useRef, useState } from "react";
import { flagCrossingDetails, RequestError, type CrossingAccess as Access, type CrossingBypass, type Gate } from "../api";
import { Icon } from "../ui/Icon";

const accessLabel = { allowed: "Allowed", restricted: "Restricted", unknown: "Unknown" } as const;

function bypassLink(bypass: CrossingBypass): string {
  const params = new URLSearchParams({ api: "1", query: `${bypass.lat},${bypass.lon}` });
  return `https://www.google.com/maps/search/?${params}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function CrossingAccess({ access, gate, canFlag, saved }: { access: Access; gate: Gate; canFlag: boolean; saved: boolean }) {
  const request = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);

  async function flag() {
    if (!canFlag || request.current || sent) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    setSending(true);
    setError("");
    try {
      await flagCrossingDetails(gate, ctrl.signal);
      if (!ctrl.signal.aborted) setSent(true);
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof RequestError ? err.message :
        "Could not confirm the flag. Try again when the connection is available.");
    } finally {
      if (!ctrl.signal.aborted) setSending(false);
      request.current = null;
    }
  }

  return <section className="crossing-access" aria-label="Crossing access and bypasses">
    {saved && <p className="quiet">Saved crossing details · road conditions may have changed.</p>}
    {access.bypasses.length > 0 && <ul className="bypass-list">
      {access.bypasses.map((bypass) => <li key={`${bypass.kind}-${bypass.lat}-${bypass.lon}`}>
        <a className="ghost bypass-link" href={bypassLink(bypass)} target="_blank" rel="noopener noreferrer">
          <span><strong>{bypass.kind === "flyover" ? "Open flyover pin in Maps" : "Open underpass pin in Maps"}</strong><small>{bypass.name}</small></span><Icon name="chevron" size={16} />
        </a>
        <p className="quiet">{bypass.replacement ? "Replacement crossing · " : ""}Verified {formatDate(bypass.verified_on)}</p>
      </li>)}
    </ul>}
    <details className="disclosure">
      <summary>Crossing access</summary>
      <dl>
        <div><dt>Cars</dt><dd>{accessLabel[access.cars]}</dd></div>
        <div><dt>Two-wheelers</dt><dd>{accessLabel[access.two_wheelers]}</dd></div>
        <div><dt>Pedestrians</dt><dd>{accessLabel[access.pedestrians]}</dd></div>
      </dl>
      <p className="quiet">{access.source === "mapped" ? "Access from map data."
        : access.source === "verified" && access.verified_on ? `Access verified ${formatDate(access.verified_on)}.` : "Road access evidence unavailable."}</p>
      {!access.bypasses.length && <p className="quiet">No verified bypass listed.</p>}
      <button type="button" className="ghost compact" onClick={flag} aria-disabled={!canFlag || sending || sent}>
        Flag outdated details
      </button>
      <p className="quiet control-feedback" role="status" aria-atomic="true">{sent ? "Flag sent for review." : sending ? "Sending flag…"
        : error || (!canFlag ? "Flagging requires a current crossing check." : "")}</p>
    </details>
  </section>;
}
