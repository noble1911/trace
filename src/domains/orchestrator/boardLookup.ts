import { rememberedIssueBoard } from "@/domains/board/issueBoards";
import { useBoardStore } from "@/domains/board/store";
import { findCustomBoard } from "@/domains/boards/findCard";
import { useIssuesStore } from "@/domains/issues/store";
import {
  type BoardData,
  boardOptionKey,
  type Issue,
  type ProviderKind,
  trackerForIssueKey,
} from "@/domains/issues/types";
import { getBoard } from "@/ipc/issues";
import { normalizeKey, parseBoardRef } from "./boardRef";

// Which board a tool call is about. The board tools used to work only on the board shown
// in the UI; these find any: the shown one first (no fetch), else the board a reference
// names, else the board the ticket is known to be on. Errors are sentences for the model.

/** A board the tools can read, and whether it is the one shown in trace. */
export interface LoadedBoard {
  /** `provider:boardId`. */
  boardKey: string;
  provider: ProviderKind;
  data: BoardData;
  shown: boolean;
}

/** The switcher key of the board the UI shows, or null. */
export function shownBoardKey(): string | null {
  const { boardKey, data } = useBoardStore.getState();
  return data ? boardKey : null;
}

const TRACKER_NAMES: Record<ProviderKind, string> = {
  jira: "Jira",
  pylon: "Pylon",
  custom: "trace",
};

/** Throws a sentence when the tracker isn't connected (trace's own boards always are). */
function requireConnected(provider: ProviderKind): void {
  if (provider !== "custom" && !useIssuesStore.getState().sessions[provider]) {
    throw new Error(
      `${TRACKER_NAMES[provider]} isn't connected: connect it in trace's Integrations.`
    );
  }
}

/**
 * Read a board by its `provider:boardId`. The shown board comes from the store; any other
 * is fetched without changing what the UI shows.
 */
export async function loadBoard(ref: string): Promise<LoadedBoard> {
  const parsed = parseBoardRef(ref);
  if (!parsed) {
    throw new Error(`"${ref}" isn't a board reference: use provider:boardId as list_boards shows.`);
  }
  const boardKey = boardOptionKey(parsed.provider, parsed.boardId);
  const state = useBoardStore.getState();
  if (state.data && state.boardKey === boardKey) {
    return { boardKey, provider: parsed.provider, data: state.data, shown: true };
  }
  requireConnected(parsed.provider);
  try {
    const data = await getBoard(parsed.provider, parsed.boardId);
    return { boardKey, provider: parsed.provider, data, shown: false };
  } catch (e) {
    throw new Error(
      `Couldn't read board ${boardKey}: ${String(e instanceof Error ? e.message : e).replace(/^Error:\s*/i, "")}`
    );
  }
}

/** Whether trace has seen this key on a tracker's board: shown, running, or remembered. */
function seenOnTracker(key: string): boolean {
  const { data, provider, runningAgents } = useBoardStore.getState();
  if (provider !== "custom" && data?.issues.some((i) => i.key === key)) return true;
  // A trace card's key is lowercase, so a running upper-case one is a tracker's.
  if (runningAgents.has(key)) return true;
  const board = rememberedIssueBoard(key);
  return board !== null && !board.startsWith("custom:");
}

/** A key a model passed, as its tracker writes it (`normalizeKey`, with what trace has seen). */
export function issueKeyFrom(raw: string): string {
  return normalizeKey(raw, seenOnTracker);
}

/** A ticket and the board it's on. */
export interface LocatedIssue {
  key: string;
  issue: Issue;
  board: LoadedBoard;
}

/** The boards a ticket of this tracker is likely on, besides the shown one. */
async function candidateBoards(key: string, tracker: ProviderKind): Promise<string[]> {
  const issues = useIssuesStore.getState();
  const likely =
    tracker === "custom"
      ? [await findCustomBoard(key)]
      : [
          rememberedIssueBoard(key),
          issues.savedBoardFor(tracker),
          // Pylon has one board; a Jira account can have hundreds, so don't try them all.
          ...(tracker === "pylon" ? issues.boards.filter((b) => b.provider === tracker) : []).map(
            (b) => b.key
          ),
        ];
  const shown = shownBoardKey();
  return likely.filter(
    (k, i, all): k is string =>
      k !== null && k !== shown && k.startsWith(`${tracker}:`) && all.indexOf(k) === i
  );
}

/**
 * Find a ticket and its board. With `boardRef` it must be on that board. Without, the
 * shown board first, then (by the key's tracker) the board it was last seen on, the
 * tracker's saved board, or for a trace card the board that holds it.
 */
export async function locateIssue(rawKey: string, boardRef = ""): Promise<LocatedIssue> {
  const key = issueKeyFrom(rawKey);
  if (boardRef.trim()) {
    const board = await loadBoard(boardRef);
    const issue = board.data.issues.find((i) => i.key === key);
    if (!issue) throw new Error(`No ticket ${key} on board ${board.boardKey}.`);
    return { key, issue, board };
  }
  const state = useBoardStore.getState();
  const onShown = state.data?.issues.find((i) => i.key === key);
  if (onShown && state.data && state.boardKey && state.provider) {
    const board = { boardKey: state.boardKey, provider: state.provider, data: state.data };
    return { key, issue: onShown, board: { ...board, shown: true } };
  }
  const tracker = trackerForIssueKey(key);
  requireConnected(tracker);
  for (const ref of await candidateBoards(key, tracker)) {
    try {
      const board = await loadBoard(ref);
      const issue = board.data.issues.find((i) => i.key === key);
      if (issue) return { key, issue, board };
    } catch {
      // That board couldn't be read: try the next.
    }
  }
  throw new Error(
    `Couldn't find ${key} on the shown board or the boards trace knows it by. It may be closed, or on a board not opened yet: pass board (provider:boardId, see list_boards).`
  );
}
