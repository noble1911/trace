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

/** A kind of card on a custom board, with its own brief when it needs one. */
export interface CardType {
  id: string;
  name: string;
  /** Replaces the board's brief for cards of this type; null uses the board's. */
  prompt: string | null;
}

/** A custom board's setup beyond its columns: its card types. */
export interface CustomBoardConfig {
  id: string;
  name: string;
  cardTypes: CardType[];
}

/** What a new board starts with (a template's columns and card types). */
export interface BoardTemplate {
  columns: { name: string; category: StatusCategory }[];
  cardTypes: { name: string; prompt?: string }[];
}

/** Make a board; without a template it starts with To do / In progress / Done. */
export function customBoardCreate(name: string, template?: BoardTemplate): Promise<BoardSummary> {
  return invoke("custom_board_create", { name, template: template ?? null });
}

export function customBoardConfig(boardId: string): Promise<CustomBoardConfig> {
  return invoke("custom_board_config", { boardId });
}

export function renameCustomBoard(boardId: string, name: string): Promise<void> {
  return invoke("custom_board_rename", { boardId, name });
}

/** Refused while one of its cards' agents runs. */
export function deleteCustomBoard(boardId: string): Promise<void> {
  return invoke("custom_board_delete", { boardId });
}

export function customCardTypeAdd(
  boardId: string,
  name: string,
  prompt?: string
): Promise<CustomBoardConfig> {
  return invoke("custom_card_type_add", { boardId, name, prompt: prompt ?? null });
}

/** Rename a type and/or set its prompt; an empty prompt clears it, a field left out stays. */
export function customCardTypeUpdate(
  boardId: string,
  typeId: string,
  change: { name?: string; prompt?: string }
): Promise<CustomBoardConfig> {
  return invoke("custom_card_type_update", { boardId, typeId, ...change });
}

/**
 * Delete a type. Its cards go to `moveCardsTo` (another type's id, or "" for no type);
 * refused when it has cards and that's left out.
 */
export function customCardTypeDelete(
  boardId: string,
  typeId: string,
  moveCardsTo?: string
): Promise<CustomBoardConfig> {
  return invoke("custom_card_type_delete", { boardId, typeId, moveCardsTo });
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
  /** One of the board's card types; left out keeps the card's (none on create). */
  typeId?: string;
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
