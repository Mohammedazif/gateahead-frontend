/** Keep the original receipt clock when a server and device disagree. */
export function snapshotTime(source: number | undefined, received: number | undefined): number | undefined {
  const validSource = source != null && Number.isFinite(source);
  const validReceipt = received != null && Number.isFinite(received);
  if (!validReceipt) return validSource ? source : undefined;
  // A normal reply can spend time in transit. A future source clock, or an
  // offset beyond the request window, cannot reliably measure device aging.
  if (!validSource || source > received || received - source > 120000) return received;
  return source;
}
