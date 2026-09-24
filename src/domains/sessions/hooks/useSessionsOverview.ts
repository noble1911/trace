import { useEffect, useState } from "react";
import { type SessionOverview, sessionsOverview } from "@/ipc/workspace";

/** Re-read branches + PRs this often while the list is on screen. */
const REFRESH_MS = 60_000;

// Module-level so returning to the Sessions page shows the last answer at once
// (no pop-in), then refreshes behind it.
let cache: Record<string, SessionOverview> = {};

/**
 * Branch + PR per session for the list rows. One backend call for the whole
 * page (`sessions_overview` does one `gh pr list` per repo), refreshed every
 * minute and on window focus — PRs get merged in the browser, not in trace.
 */
export function useSessionsOverview(ids: string[]): Record<string, SessionOverview> {
  const [rows, setRows] = useState(cache);
  const key = Array.from(new Set(ids)).sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () => {
      sessionsOverview(key.split(","))
        .then((list) => {
          if (cancelled) return;
          cache = { ...cache, ...Object.fromEntries(list.map((r) => [r.id, r])) };
          setRows(cache);
        })
        .catch(() => {
          // Best-effort decoration — rows render fine without it.
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [key]);

  return rows;
}
