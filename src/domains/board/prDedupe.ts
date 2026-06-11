import type { PullRequest } from "@/domains/jira/types";

// Jira's dev-status reports the same PR under every issue it closes, and the
// per-issue caches can disagree (one stale "open", one fresh "merged"). When
// deduping by url, keep the most FINAL state — a PR can move open → merged
// but never back, so the more-final report is always the newer truth.

const FINALITY: Record<string, number> = { merged: 3, declined: 2, closed: 2 };

function finality(state: string): number {
  return FINALITY[state.toLowerCase()] ?? 1; // open / draft / unknown = live
}

export function dedupePrs<T>(entries: [PullRequest, T][]): [PullRequest, T][] {
  const byUrl = new Map<string, [PullRequest, T]>();
  for (const entry of entries) {
    const [pr] = entry;
    if (!pr.url) continue;
    const existing = byUrl.get(pr.url);
    if (!existing || finality(pr.state) > finality(existing[0].state)) {
      byUrl.set(pr.url, entry);
    }
  }
  return [...byUrl.values()];
}
