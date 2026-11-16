import type { TrainCoverage } from "../api";

export function CoverageNotice({ coverage }: { coverage?: TrainCoverage }) {
  if (!coverage) return null;
  let message = "";
  if ((coverage.unavailable_discovery ?? 0) > 0) {
    message = "Some train searches did not complete. Available reports may omit services; coverage is incomplete.";
  } else if (coverage.pending_live > 0) {
    message = `${coverage.live_checked} of ${coverage.live_candidates} train checks completed. ${coverage.pending_live} still pending; refresh to continue.`;
  } else if (coverage.missing_or_stale_routes > 0) {
    message = "Some train timetables are missing or need refreshing. Coverage is incomplete.";
  } else if ((coverage.unavailable_live ?? 0) > 0) {
    message = "Some services have no current running report. Coverage is incomplete.";
  }
  return message ? <p className="notice" role="status">{message}</p> : null;
}
