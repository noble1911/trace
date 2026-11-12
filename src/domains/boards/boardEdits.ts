import { toast } from "@/app/toast";
import { rememberBoard } from "@/domains/board/boardCache";
import { boardLoads } from "@/domains/board/loadGuard";
import { useBoardStore } from "@/domains/board/store";
import type { BoardData, Issue, StatusCategory } from "@/domains/issues/types";
import {
  addCustomColumn,
  createCustomCard,
  deleteCustomCard,
  deleteCustomColumn,
  moveCustomColumn,
  updateCustomCard,
  updateCustomColumn,
} from "@/ipc/customBoards";
import type { CardDraftFields } from "./cardDraft";

// Edits to the custom board on screen. Each command answers with what changed (the
// board's fresh `BoardData`, or the card), and the board store takes that as it is:
// no second fetch, and no copy of the board kept anywhere else. A failure is a toast
// with the backend's reason (a running agent, a column with cards and no target).

/** The loaded board's id, when it's a custom one: every edit here needs it. */
function loadedCustomBoard(): string | null {
  const { provider, data } = useBoardStore.getState();
  return provider === "custom" && data ? data.boardId : null;
}

/** Put a board the backend just returned on screen, if it's still the one shown. A load
 * that was in flight meanwhile answers with older cards, so it's dropped (`loadGuard`). */
export function applyBoardData(data: BoardData): void {
  const s = useBoardStore.getState();
  if (s.provider !== "custom" || s.data?.boardId !== data.boardId || !s.boardKey) return;
  boardLoads.noteEdit();
  useBoardStore.setState({ data });
  rememberBoard(s.boardKey, data, s.pullRequests);
}

/** Put one card the backend returned on its board, if that's still the one shown:
 * replaced where it was, or added. */
function applyIssue(issue: Issue, boardId: string): void {
  const data = useBoardStore.getState().data;
  if (data?.boardId !== boardId) return;
  const known = data.issues.some((i) => i.key === issue.key);
  const issues = known
    ? data.issues.map((i) => (i.key === issue.key ? issue : i))
    : [...data.issues, issue];
  applyBoardData({ ...data, issues });
}

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

/** Run one edit; on failure say why and answer false, so a form stays open. */
async function attempt<T>(what: string, run: (boardId: string) => Promise<T>): Promise<T | null> {
  const boardId = loadedCustomBoard();
  if (!boardId) return null;
  try {
    return await run(boardId);
  } catch (err) {
    toast.error(`Couldn't ${what}: ${reason(err)}`);
    return null;
  }
}

export async function addColumn(name: string, category: StatusCategory): Promise<boolean> {
  const data = await attempt("add the column", (id) => addCustomColumn(id, name, category));
  if (data) applyBoardData(data);
  return data !== null;
}

export async function updateColumn(
  columnId: string,
  change: { name?: string; category?: StatusCategory }
): Promise<boolean> {
  const data = await attempt("change the column", (id) => updateCustomColumn(id, columnId, change));
  if (data) applyBoardData(data);
  return data !== null;
}

export async function moveColumn(columnId: string, toIndex: number): Promise<void> {
  const data = await attempt("move the column", (id) => moveCustomColumn(id, columnId, toIndex));
  if (data) applyBoardData(data);
}

export async function deleteColumn(columnId: string, moveCardsTo?: string): Promise<boolean> {
  const data = await attempt("delete the column", (id) =>
    deleteCustomColumn(id, columnId, moveCardsTo)
  );
  if (data) applyBoardData(data);
  return data !== null;
}

export async function createCard(fields: CardDraftFields, columnId: string): Promise<Issue | null> {
  // The board it's made on: another may be showing by the time it's made.
  const boardId = loadedCustomBoard();
  const issue = await attempt("add the card", (id) =>
    createCustomCard(id, { ...fields, columnId })
  );
  if (issue && boardId) applyIssue(issue, boardId);
  return issue;
}

export async function updateCard(key: string, fields: CardDraftFields): Promise<boolean> {
  const boardId = loadedCustomBoard();
  const issue = await attempt(`save ${key}`, () => updateCustomCard(key, fields));
  if (issue && boardId) applyIssue(issue, boardId);
  return issue !== null;
}

/** Delete a card (refused while its agent runs), closing its detail if it's open. */
export async function deleteCard(key: string): Promise<boolean> {
  const done = await attempt(`delete ${key}`, () => deleteCustomCard(key).then(() => true));
  if (!done) return false;
  const s = useBoardStore.getState();
  if (s.selectedIssueKey === key) s.closeIssue();
  if (s.data) applyBoardData({ ...s.data, issues: s.data.issues.filter((i) => i.key !== key) });
  toast.success(`Deleted ${key}`);
  return true;
}
