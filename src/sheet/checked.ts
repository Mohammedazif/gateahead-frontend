export function checkedAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `Checked ${hours} hr ago`;
  return `Checked ${hours} hr ${mins} min ago`;
}
