import { invoke } from "@tauri-apps/api/core";
import type {
  BoardData,
  BoardSummary,
  Issue,
  Priority,
  StatusCategory,
} from "@/domains/issues/types";

// Typed wrappers around the custom-board commands (`commands/custom_boards.rs`): boards
// the user makes in trace. Reading one, moving its cards and commenting go through the
// ordinary board commands in `ipc/issues.ts` with `provider: "custom"`. Structure edits
// return the board's fresh `BoardData`, so the store takes it as it is.

export function createCustomBoard(name: string): Promise<BoardSummary> {
  return invoke("custom_board_create", { name });
}

export function renameCustomBoard(boardId: string, name: string): Promise<void> {
  return invoke("custom_board_rename", { boardId, name });
}

/** Refused while one of its cards' agents runs. */
export function deleteCustomBoard(boardId: string): Promise<void> {
  return invoke("custom_board_delete", { boardId });
}

export function addCustomColumn(
  boardId: string,
  name: string,
  category: StatusCategory
): Promise<BoardData> {
  return invoke("custom_column_add", { boardId, name, category });
}

/** Rename a column and/or set its category; a field left out stays as it is. */
export function updateCustomColumn(
  boardId: string,
  columnId: string,
  change: { name?: string; category?: StatusCategory }
): Promise<BoardData> {
  return invoke("custom_column_update", { boardId, columnId, ...change });
}

export function moveCustomColumn(
  boardId: string,
  columnId: string,
  toIndex: number
): Promise<BoardData> {
  return invoke("custom_column_move", { boardId, columnId, toIndex });
}

/** Refused when the column has cards and no `moveCardsTo` column takes them. */
export function deleteCustomColumn(
  boardId: string,
  columnId: string,
  moveCardsTo?: string
): Promise<BoardData> {
  return invoke("custom_column_delete", { boardId, columnId, moveCardsTo });
}

/** A card's editable fields. */
export interface CardFields {
  summary: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
}

/** A new card, in `columnId` (the board's first column when left out). */
export function createCustomCard(
  boardId: string,
  fields: CardFields & { columnId?: string }
): Promise<Issue> {
  return invoke("custom_card_create", { boardId, ...fields });
}

/** Change a card's fields; a field left out stays as it is. */
export function updateCustomCard(key: string, fields: Partial<CardFields>): Promise<Issue> {
  return invoke("custom_card_update", { key, ...fields });
}

/** Refused while its agent runs. */
export function deleteCustomCard(key: string): Promise<void> {
  return invoke("custom_card_delete", { key });
}
