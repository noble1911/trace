import type { BoardOption, ProviderKind } from "../issues/types.ts";

// Which boards the rail's Boards group lists, and how each is told apart. Pure, so the
// rules are tested on their own (`railBoardList.test.ts`); `RailBoards` draws them.

/** How many boards the group lists before the rest go under "All boards". */
export const RAIL_BOARD_LIMIT = 6;

/** When each board was last opened (ms), by board key (`boardRecency`). */
export type LastOpened = Readonly<Record<string, number>>;

/** Trackers in the order their never-opened boards come. */
const TRACKER_ORDER: Record<ProviderKind, number> = { jira: 0, pylon: 1, custom: 2 };

/**
 * Every board, most recently opened first. Boards never opened come after the used
 * ones, in the trackers' own order (Jira, Pylon, then trace's), each tracker's boards
 * as it lists them.
 */
export function boardsByUse(boards: readonly BoardOption[], lastOpened: LastOpened): BoardOption[] {
  return boards
    .map((board, i) => ({ board, i, at: lastOpened[board.key] }))
    .sort((a, b) => {
      if (a.at !== undefined && b.at !== undefined) return b.at - a.at || a.i - b.i;
      if (a.at !== undefined) return -1;
      if (b.at !== undefined) return 1;
      return TRACKER_ORDER[a.board.provider] - TRACKER_ORDER[b.board.provider] || a.i - b.i;
    })
    .map((x) => x.board);
}

export interface RailBoards {
  /** The boards to show as buttons, in order. */
  shown: BoardOption[];
  /** Whether there are more than fit (the "All boards" menu lists every one). */
  hasMore: boolean;
}

/**
 * The group's boards: at most `limit`, most recently opened first. The board on screen
 * is always among them; when it wouldn't be, it takes the last place.
 */
export function pickRailBoards(
  boards: readonly BoardOption[],
  lastOpened: LastOpened,
  selectedKey: string | null,
  limit = RAIL_BOARD_LIMIT
): RailBoards {
  const sorted = boardsByUse(boards, lastOpened);
  let shown = sorted.slice(0, limit);
  const selected = sorted.find((b) => b.key === selectedKey);
  if (selected && !shown.includes(selected)) shown = [...shown.slice(0, limit - 1), selected];
  return { shown, hasMore: sorted.length > limit };
}

/** The board the Boards button opens: the one last opened, else the one selected, else
 * the first; null with no boards at all. */
export function lastUsedBoard(
  boards: readonly BoardOption[],
  lastOpened: LastOpened,
  selectedKey: string | null
): BoardOption | null {
  const [first] = boardsByUse(boards, lastOpened);
  if (first && lastOpened[first.key] !== undefined) return first;
  return boards.find((b) => b.key === selectedKey) ?? first ?? null;
}

/**
 * A board's initials, to tell boards of one type apart: the first letters of its first
 * two words ("PM Delivery" → "PD"), or a one-word name's first two ("Support" → "Su").
 * Words are runs of letters and digits; a name with none has no initials ("").
 */
export function boardInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "";
  if (words.length === 1) {
    const [a = "", b = ""] = Array.from(words[0]);
    return a.toUpperCase() + b.toLowerCase();
  }
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join("");
}

/** The boards with an agent waiting on you: each waiting workspace's board, where it's
 * known (`boardOf`, from the boards its tickets were last seen on). */
export function boardsNeedingYou(
  lights: Readonly<Record<string, { light: string }>>,
  boardOf: (workspaceId: string) => string | null
): Set<string> {
  const out = new Set<string>();
  for (const [id, info] of Object.entries(lights)) {
    if (info.light !== "attention") continue;
    const board = boardOf(id);
    if (board) out.add(board);
  }
  return out;
}

/** Parse stored "last opened" times: only finite numbers under string keys survive. */
export function parseLastOpened(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(raw)) {
    if (typeof at === "number" && Number.isFinite(at)) out[key] = at;
  }
  return out;
}
