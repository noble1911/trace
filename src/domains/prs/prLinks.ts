import type { FoundPrs } from "@/ipc/prWatch";

// How one look for a workspace's PRs updates the ones already known.
//
// A look that heard from every source (the branch on GitHub, the conversation
// logs) is the answer, and replaces the list. One that didn't (gh offline or
// rate-limited, the worktree mid-rebase on a detached HEAD) is only part of it:
// its PRs are added and none are dropped. Replacing with a partial answer emptied
// the list, which greyed out the Pull request tab until the next good look.

/** The workspace's PR list after `found`: newly found first, then the rest known. */
export function nextPrLinks(known: string[] | undefined, found: FoundPrs): string[] {
  if (found.complete || !known) return found.urls;
  return [...new Set([...found.urls, ...known])];
}
