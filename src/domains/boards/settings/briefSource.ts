import { rememberedIssueBoard } from "@/domains/board/issueBoards";
import { useBoardStore } from "@/domains/board/store";
import { boardOptionFor } from "@/domains/issues/store";
import type { Issue } from "@/domains/issues/types";
import { type TypePrompt, typePromptFor } from "./brief";
import { useBoardSetup } from "./store";

// What a ticket's board adds to its kickoff brief, gathered at launch: its card type's
// prompt (custom boards), the board's own prompt, and the board's name for `{board}`.
// Read fresh, since a start is when it matters. Nothing here may block a launch: a read
// that fails just leaves that source out, and the global brief applies.

/** The board a ticket is on: the loaded one when it's there, else the one remembered
 * for it (an agent's ticket opened from Inbox or Fleet). */
export function issueBoardKey(issueKey: string): string | null {
  const { boardKey, data } = useBoardStore.getState();
  if (boardKey && data?.issues.some((i) => i.key === issueKey)) return boardKey;
  return rememberedIssueBoard(issueKey);
}

/** `provider:boardId` split at its first colon. */
function splitKey(boardKey: string): { provider: string; boardId: string } {
  const at = boardKey.indexOf(":");
  return at < 0
    ? { provider: "", boardId: boardKey }
    : { provider: boardKey.slice(0, at), boardId: boardKey.slice(at + 1) };
}

export interface BoardBrief {
  typePrompt: string | null;
  boardPrompt: string | null;
  /** The board's name, for `{board}` ("" when unknown). */
  board: string;
}

export async function boardBrief(issue: Issue, boardKey: string | null): Promise<BoardBrief> {
  if (!boardKey) return { typePrompt: null, boardPrompt: null, board: "" };
  const { provider, boardId } = splitKey(boardKey);
  const setup = useBoardSetup.getState();
  const [settings, config] = await Promise.all([
    setup.loadSettings(boardKey, true).catch(() => null),
    provider === "custom" ? setup.loadConfig(boardId, true).catch(() => null) : null,
  ]);
  const types: TypePrompt[] = config?.cardTypes ?? [];
  const loaded = useBoardStore.getState();
  const board =
    (loaded.boardKey === boardKey ? loaded.data?.boardName : undefined) ??
    boardOptionFor(boardKey)?.name ??
    config?.name ??
    "";
  return {
    typePrompt: typePromptFor(types, issue.issueType),
    boardPrompt: settings?.kickoffPrompt ?? null,
    board,
  };
}
