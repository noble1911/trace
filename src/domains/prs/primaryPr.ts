import type { PullRequest } from "@/domains/issues/types";
import type { PrThread } from "@/ipc/prWatch";

const toRef = (t: PrThread): PullRequest => ({
  number: String(t.number),
  url: t.url,
  state: t.state,
  title: t.title,
});

const isLive = (state: string) => state === "open" || state === "draft";

/**
 * The PR a workspace's header acts on: an open one found by the PR watcher
 * (branch or conversation), else an open one Jira's dev-status knows, else the
 * most relevant finished one — so "Raise PR" only shows when there's truly none.
 */
export function primaryPr(
  urls: string[],
  threads: Record<string, PrThread>,
  devPrs: PullRequest[]
): PullRequest | null {
  const watched = urls.map((u) => threads[u]).filter((t): t is PrThread => t != null);
  const open = watched.find((t) => isLive(t.state));
  if (open) return toRef(open);
  const devOpen = devPrs.find((p) => p.state !== "merged" && p.state !== "declined");
  if (devOpen) return devOpen;
  return watched[0] ? toRef(watched[0]) : (devPrs[0] ?? null);
}
