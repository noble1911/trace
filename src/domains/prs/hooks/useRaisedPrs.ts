import { useEffect, useState } from "react";
import { type RaisedPr, raisedPrs } from "@/ipc/prList";

/** Re-read every minute while the page is open: PRs get merged on GitHub, not in trace. */
const REFRESH_MS = 60_000;
/** A focus within this long of the last ask doesn't ask again (alt-tabbing is constant). */
const FOCUS_COOLDOWN_MS = 15_000;

// Module-level so returning to the page shows the last answer at once, then refreshes.
let cache: RaisedPr[] = [];
/** One ask at a time: each costs a few `gh` calls, and answers could land out of order. */
let inFlight = false;
/** The ids an ask came in for while one ran; asked once it ends. */
let queued: string | null = null;
let lastAskAt = 0;
const listeners = new Set<(rows: RaisedPr[]) => void>();

function ask(key: string) {
  if (inFlight) {
    queued = key;
    return;
  }
  inFlight = true;
  lastAskAt = Date.now();
  raisedPrs(key ? key.split("\n") : [])
    .then((list) => {
      cache = list;
      for (const listener of listeners) listener(list);
    })
    .catch(() => {
      // Best-effort: Jira's links and the watcher's still fill the page.
    })
    .finally(() => {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next !== null) ask(next);
    });
}

/**
 * The PRs trace's workspaces raised (`raised_prs`): `ids`' and every started
 * ticket's, refreshed every minute and on focus while the caller is mounted.
 */
export function useRaisedPrs(ids: string[]): RaisedPr[] {
  const [rows, setRows] = useState(cache);
  const key = Array.from(new Set(ids)).sort().join("\n");

  useEffect(() => {
    listeners.add(setRows);
    const load = () => {
      if (document.visibilityState === "visible") ask(key);
    };
    const onFocus = () => {
      if (Date.now() - lastAskAt >= FOCUS_COOLDOWN_MS) load();
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setRows);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [key]);

  return rows;
}

// A hot update would leave the cache on a stale copy of this module, so reload instead.
import.meta.hot?.accept(() => location.reload());
