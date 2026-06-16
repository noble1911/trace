import { useEffect, useState } from "react";
import { gitDiffSummary } from "@/ipc/diff";

/** Total lines added/removed in a session's worktree vs its base branch. */
export interface SessionDiffStat {
  add: number;
  del: number;
}

// Fetches a per-session diff summary (+adds / −dels) so the Recents cards can
// show how much each session has changed. The session id IS its workspace id —
// the same contract board agents use — so this reuses git_diff_summary as-is.
// Keyed on the joined id list: re-fetches when the *set* of sessions changes,
// not on every render. Callers pass only worktree-backed ids (a legacy session
// shares the repo root, so there's nothing isolated to diff). A failed fetch
// (e.g. a missing worktree) drops silently — the card just omits its stats.
export function useSessionDiffs(ids: string[]): Record<string, SessionDiffStat> {
  const [stats, setStats] = useState<Record<string, SessionDiffStat>>({});
  const key = ids.join(",");

  useEffect(() => {
    const idList = key ? key.split(",") : [];
    if (idList.length === 0) {
      setStats({});
      return;
    }
    let cancelled = false;
    Promise.all(
      idList.map(async (id): Promise<readonly [string, SessionDiffStat | null]> => {
        try {
          const summary = await gitDiffSummary(id);
          const add = summary.files.reduce((n, f) => n + f.add, 0);
          const del = summary.files.reduce((n, f) => n + f.del, 0);
          return [id, { add, del }];
        } catch {
          return [id, null];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, SessionDiffStat> = {};
      for (const [id, stat] of entries) if (stat) next[id] = stat;
      setStats(next);
    });
    return () => {
      cancelled = true;
    };
    // `key` encodes `ids`; depending on the array itself would re-run every render.
  }, [key]);

  return stats;
}
