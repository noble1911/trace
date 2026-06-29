import { useEffect, useState } from "react";
import { gitDiffSummary } from "@/ipc/diff";

/** Total lines added/removed in a session's worktree vs its base branch. */
export interface SessionDiffStat {
  add: number;
  del: number;
}

// Per-session cache (module-level, so it survives re-renders and remounts).
// Computing a session's diff is a real `git diff`; without this the Recents
// sidebar re-fetched every session's diff on every re-render — and because
// selecting a session *reorders* the recents list, that meant a burst of git
// subprocesses on every session switch, which froze the UI. Cache +
// stale-while-revalidate keeps switches instant and only refreshes occasionally.
interface CacheEntry {
  stat: SessionDiffStat;
  at: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 20_000;

async function fetchStat(id: string): Promise<SessionDiffStat | null> {
  try {
    const summary = await gitDiffSummary(id);
    return {
      add: summary.files.reduce((n, f) => n + f.add, 0),
      del: summary.files.reduce((n, f) => n + f.del, 0),
    };
  } catch {
    return null;
  }
}

// Diff stats for the given (worktree-backed) session ids, keyed by id. Callers
// pass only worktree sessions — a legacy session shares the repo root, so
// there's nothing isolated to diff.
export function useSessionDiffs(ids: string[]): Record<string, SessionDiffStat> {
  const [stats, setStats] = useState<Record<string, SessionDiffStat>>({});
  // Key on the sorted, de-duped id *set* — selecting a session reorders the
  // recents list but the set is unchanged, so this must not re-fetch.
  const key = Array.from(new Set(ids)).sort().join(",");

  useEffect(() => {
    const idList = key ? key.split(",") : [];
    // Show whatever we already have (even slightly stale) right away — no
    // flicker, no spinner — then refresh anything missing or past its TTL.
    const seeded: Record<string, SessionDiffStat> = {};
    for (const id of idList) {
      const entry = cache.get(id);
      if (entry) seeded[id] = entry.stat;
    }
    setStats(seeded);

    const now = Date.now();
    const stale = idList.filter((id) => {
      const entry = cache.get(id);
      return !entry || now - entry.at >= TTL_MS;
    });
    if (stale.length === 0) return;

    let cancelled = false;
    // Sequential, not Promise.all: each summary spawns git, and a burst is what
    // caused the freeze. Cards fill in progressively; the backend stays calm.
    void (async () => {
      for (const id of stale) {
        const stat = await fetchStat(id);
        if (cancelled) return;
        if (stat) {
          cache.set(id, { stat, at: Date.now() });
          setStats((prev) => ({ ...prev, [id]: stat }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` encodes the id set; depending on the array would re-run every render.
  }, [key]);

  return stats;
}
