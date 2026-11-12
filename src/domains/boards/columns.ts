import type { BoardColumn, Issue, StatusCategory } from "../issues/types.ts";

// A custom board's columns, as the UI edits them. On a custom board a column is exactly
// one status (its id is the status id cards carry), and its category is what makes
// auto-start and cleanup work, so it's chosen by meaning rather than by name.

/** The three categories, in the order a board usually runs. */
export const CATEGORIES: StatusCategory[] = ["new", "indeterminate", "done"];

/** Each category as the user reads it. */
export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  new: "To do",
  indeterminate: "In progress",
  done: "Done",
};

/** A custom column's id: its one status's. Null for a column with no status. */
export function columnId(column: BoardColumn): string | null {
  return column.statuses[0]?.id ?? null;
}

/** A custom column's category (its one status's). */
export function columnCategory(column: BoardColumn): StatusCategory {
  return column.statuses[0]?.category ?? "new";
}

/** The column dot's colour on a custom board: by what the column means, not its place. */
export function categoryColor(category: StatusCategory): string {
  if (category === "done") return "var(--c-done)";
  if (category === "indeterminate") return "var(--c-prog)";
  return "var(--c-todo)";
}

/** How many cards are in a column. */
export function cardCount(issues: Issue[], id: string): number {
  return issues.filter((i) => i.statusId === id).length;
}

/** Where a column's cards can go when it's deleted: every other column, in board order. */
export function moveTargets(columns: BoardColumn[], id: string): { id: string; name: string }[] {
  return columns.flatMap((c) => {
    const other = columnId(c);
    return other && other !== id ? [{ id: other, name: c.name }] : [];
  });
}

/** The index a column moves to one step left (-1) or right (1), or null at an end. */
export function stepIndex(columns: BoardColumn[], id: string, delta: -1 | 1): number | null {
  const at = columns.findIndex((c) => columnId(c) === id);
  if (at === -1) return null;
  const to = at + delta;
  return to >= 0 && to < columns.length ? to : null;
}

/** A name the user typed, trimmed; null when there's nothing left. */
export function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name === "" ? null : name;
}
