/** "just now" / "5m ago" / "3h ago" / "2d ago" for epoch seconds. */
export function relTime(epochSecs: number): string {
  const diff = Date.now() / 1000 - epochSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
