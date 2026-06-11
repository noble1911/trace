import type { BoardColumn, Issue } from "@/domains/jira/types";

// First column reads neutral, last reads "done" green, middle cycles amber/violet —
// generalizes the design's 4-column palette to whatever columns the board has.
const PALETTE = ["var(--c-todo)", "var(--c-prog)", "var(--c-review)"];

export function columnColor(index: number, total: number): string {
  if (total > 1 && index === total - 1) return "var(--c-done)";
  return PALETTE[Math.min(index, PALETTE.length - 1)];
}

/** Bucket issues into columns by matching the issue's status id to the column. */
export function groupIssuesByColumn(columns: BoardColumn[], issues: Issue[]): Issue[][] {
  return columns.map((col) => issues.filter((i) => col.statuses.some((s) => s.id === i.statusId)));
}

/**
 * Whether moving to `statusId` means "work starts here": the status is
 * in-progress (Jira category `indeterminate`) AND lives in the board's *first*
 * in-progress column. Later indeterminate columns (In Review, QA, …) shouldn't
 * auto-start agents. No column names are hardcoded — only Jira's categories.
 */
export function isStartOfWork(columns: BoardColumn[], statusId: string): boolean {
  const first = columns.find((c) => c.statuses.some((s) => s.category === "indeterminate"));
  return !!first?.statuses.some((s) => s.id === statusId && s.category === "indeterminate");
}
