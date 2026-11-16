export type RunIdentity = { run_id?: string; start_date?: string };

export function runKey(row: RunIdentity & { train?: string; number?: string }): string {
  return row.run_id || (row.start_date ? `${row.train || row.number}:${row.start_date}` : row.train || row.number || "");
}

export function runDateLabel(row: RunIdentity): string {
  return row.start_date ? `Started ${row.start_date}` : "";
}
