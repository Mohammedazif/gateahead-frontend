import { friendlyError, type MapAvailability, type TrainCoverage } from "../api";
import { incompleteCheck } from "../features";

export function CoverageNotice({ coverage, map_warning, map_age_seconds }: MapAvailability & { coverage?: TrainCoverage }) {
  if (map_warning) {
    const age = map_age_seconds == null ? "" : ` The map was last checked ${Math.max(1, Math.round(map_age_seconds / 60))} min ago.`;
    return <p className="notice" role="status">{friendlyError(map_warning)} Train coverage is incomplete.{age}</p>;
  }
  if (!incompleteCheck({ coverage }) || !coverage) return null;
  let message = "";
  if ((coverage.unavailable_discovery ?? 0) > 0) {
    message = "Some train searches did not complete. Available reports may omit services; coverage is incomplete.";
  } else if (coverage.pending_live > 0) {
    message = `${coverage.live_checked} of ${coverage.live_candidates} train checks completed. ${coverage.pending_live} still pending; refresh to continue.`;
  } else if (coverage.missing_or_stale_routes > 0) {
    message = "Some train timetables are missing or need refreshing. Coverage is incomplete.";
  } else if ((coverage.unavailable_live ?? 0) > 0) {
    message = "Some services have no current running report. Coverage is incomplete.";
  } else {
    message = "The latest train check was incomplete. Some services may be missing.";
  }
  return message ? <p className="notice" role="status">{message}</p> : null;
}
