import type { BoardColumn, ColumnStatus, ProviderKind } from "../issues/types.ts";

// How the board tools read what a model passes in: a ticket key, a board reference
// (`provider:boardId`) and a column or status name. Pure, so `npm test` can load it.

const PROVIDERS: ProviderKind[] = ["jira", "pylon", "custom"];

/**
 * A ticket key as its tracker writes it: Pylon's `#123` stays as it is, Jira's are
 * upper-cased, and a trace board's `local-12` is lowercase. `LOCAL-12` is ambiguous: a
 * Jira project can be keyed LOCAL. Written exactly `local-12` it's a trace card; any
 * other casing is the Jira ticket when `isTrackerKey` knows the upper-case key (trace has
 * seen it on a tracker's board), else the trace card.
 */
export function normalizeKey(
  raw: string,
  isTrackerKey: (key: string) => boolean = () => false
): string {
  const key = raw.trim();
  if (key.startsWith("#")) return key;
  const upper = key.toUpperCase();
  if (!/^local-\d+$/i.test(key)) return upper;
  return key === key.toLowerCase() || !isTrackerKey(upper) ? key.toLowerCase() : upper;
}

/** A board reference as `list_boards` prints it: `jira:42`, `pylon:open-issues`, `custom:<id>`. */
export interface BoardRef {
  provider: ProviderKind;
  boardId: string;
}

/** Split `provider:boardId`; null when it isn't one (an unknown tracker, or no board id). */
export function parseBoardRef(raw: string): BoardRef | null {
  const text = raw.trim();
  const at = text.indexOf(":");
  if (at < 1) return null;
  const provider = PROVIDERS.find((p) => p === text.slice(0, at).toLowerCase());
  const boardId = text.slice(at + 1).trim();
  return provider && boardId ? { provider, boardId } : null;
}

/** The first item whose name is `want` exactly, else the first that matches ignoring case. */
export function matchName<T>(items: T[], want: string, nameOf: (item: T) => string): T | null {
  const wanted = want.trim();
  const lower = wanted.toLowerCase();
  return (
    items.find((i) => nameOf(i) === wanted) ??
    items.find((i) => nameOf(i).toLowerCase() === lower) ??
    null
  );
}

/** Where a move goes: a column (all its statuses are candidates) or one status. */
export interface MoveTarget {
  name: string;
  statuses: ColumnStatus[];
}

/**
 * What a model's "target_status" means on a board. It names what it sees, a column, so
 * match columns first (exact, then ignoring case); fall back to a single status's name.
 */
export function resolveTarget(columns: BoardColumn[], want: string): MoveTarget | null {
  const column = matchName(columns, want, (c) => c.name);
  if (column) return { name: column.name, statuses: column.statuses };
  const statuses = columns.flatMap((c) => c.statuses);
  const status = matchName(statuses, want, (s) => s.name);
  if (!status) return null;
  const same = statuses.filter((s) => s.name.toLowerCase() === status.name.toLowerCase());
  return { name: status.name, statuses: same };
}

/** The sentence for a name that matched no column, listing the ones that exist. */
export function noColumnMessage(columns: BoardColumn[], want: string): string {
  const names = columns.map((c) => c.name).join(", ");
  return `No column or status named "${want}". Board columns: ${names || "(none)"}.`;
}
