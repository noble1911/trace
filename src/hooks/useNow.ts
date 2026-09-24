import { useEffect, useState } from "react";

/**
 * The current time (epoch secs), re-rendering every `intervalMs` so relative
 * labels ("next in 3m", an elapsed counter) stay fresh. `null` = don't tick.
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (intervalMs == null) return;
    setNow(Date.now() / 1000);
    const t = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
