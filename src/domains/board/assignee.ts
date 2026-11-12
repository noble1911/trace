import type { ProviderKind } from "../issues/types.ts";

// Whose tickets a board shows. One rule for the board, its stats panel and the
// assistant's snapshot, so they never disagree. Pure, so `npm test` can load it.

/**
 * The assignee a board is filtered to: `null` for everyone. A trace board (custom) has
 * no assignees, so it always shows everyone, whatever filter was saved for the trackers'
 * boards. Otherwise the saved filter (`null` = everyone, an accountId = that person), and
 * until the user has picked one (`undefined`), themselves.
 */
export function effectiveAssignee(
  provider: ProviderKind | null,
  saved: string | null | undefined,
  currentUserId: string | null
): string | null {
  if (provider === "custom") return null;
  return saved === undefined ? currentUserId : saved;
}
