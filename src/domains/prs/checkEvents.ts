import { activity } from "@/domains/activity/store";
import type { PrThread } from "@/ipc/prWatch";

// CI outcomes onto the activity log. Only *transitions* the watcher observes
// count — a PR's first fetch is its baseline, so a relaunch doesn't replay every
// red build. Coverage is only as wide as the polling: a PR nobody has open in a
// view isn't watched, so its checks go unlogged.

type ChecksKind = "checks-failed" | "checks-passed";

/** The CI change between two fetches of a PR worth logging, if any. */
export function checksTransition(prev: PrThread | undefined, next: PrThread): ChecksKind | null {
  if (!prev || prev.checks === next.checks) return null;
  if (next.checks === "fail") return "checks-failed";
  if (next.checks === "ok" && prev.checks === "pending") return "checks-passed";
  return null;
}

/** Log a PR's CI transition, attributed to the workspace that raised it. */
export function logChecks(
  prev: PrThread | undefined,
  next: PrThread,
  workspaceId: string | undefined
): void {
  const kind = checksTransition(prev, next);
  if (!kind) return;
  const failing = next.checkRuns.filter((c) => c.state === "failed").map((c) => c.name);
  activity.log({
    kind,
    actor: "system",
    workspaceId,
    title:
      kind === "checks-failed" ? `CI failed on #${next.number}` : `CI passed on #${next.number}`,
    data: { url: next.url, number: next.number, prTitle: next.title, failing: failing.slice(0, 5) },
  });
}
