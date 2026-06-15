import { useBoardStore } from "@/domains/board/store";
import { gitDiffSummary } from "@/ipc/diff";

// Cross-worktree conflict detection — pure data work over each active agent's
// changed-file list. Two agents touching the same file is a merge-conflict
// waiting to happen; surfacing it early is the whole point.

export interface Conflict {
  path: string;
  keys: string[];
}

/** Files changed in more than one active worktree, plus the workspaces scanned. */
export async function findConflicts(): Promise<{ conflicts: Conflict[]; scanned: string[] }> {
  // Only real agents have their own worktree — `term:` shells share an agent's.
  const running = [...useBoardStore.getState().runningAgents].filter((k) => !k.startsWith("term:"));
  const byFile = new Map<string, Set<string>>();
  const scanned: string[] = [];
  await Promise.all(
    running.map(async (key) => {
      try {
        const summary = await gitDiffSummary(key);
        scanned.push(key);
        for (const f of summary.files) {
          const set = byFile.get(f.path) ?? new Set<string>();
          set.add(key);
          byFile.set(f.path, set);
        }
      } catch {
        // Worktree gone / not a repo — skip it rather than fail the whole scan.
      }
    })
  );

  const conflicts: Conflict[] = [];
  for (const [path, keys] of byFile) {
    if (keys.size > 1) conflicts.push({ path, keys: [...keys] });
  }
  conflicts.sort((a, b) => b.keys.length - a.keys.length || a.path.localeCompare(b.path));
  return { conflicts, scanned };
}

/** Format the conflict scan as text for the orchestrator's tool result. */
export async function describeConflicts(): Promise<string> {
  const { conflicts, scanned } = await findConflicts();
  if (scanned.length === 0) return "No active agents with a worktree to check.";
  if (conflicts.length === 0) {
    return `No overlapping changed files across ${scanned.length} active worktree(s).`;
  }
  const lines = conflicts.map((c) => `- ${c.path} — ${c.keys.join(", ")}`);
  return `Files changed in more than one worktree (possible merge conflicts):\n${lines.join("\n")}`;
}
