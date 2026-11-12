import { toast } from "@/app/toast";
import { useBoardStore } from "@/domains/board/store";
import {
  type CustomBoardConfig,
  customCardTypeAdd,
  customCardTypeDelete,
  customCardTypeUpdate,
} from "@/ipc/customBoards";
import { useBoardSetup } from "./store";

// Edits to a custom board's card types. Each applies as it's made (one command each),
// the config it answers with goes in the cache, and when the board is on screen it
// reloads too: a card shows its type by name, and renaming or deleting one changes that.

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

async function apply(
  boardId: string,
  what: string,
  run: () => Promise<CustomBoardConfig>,
  cardsChange: boolean
): Promise<boolean> {
  try {
    useBoardSetup.getState().setConfig(await run());
  } catch (err) {
    toast.error(`Couldn't ${what}: ${reason(err)}`);
    return false;
  }
  const board = useBoardStore.getState();
  if (cardsChange && board.provider === "custom" && board.data?.boardId === boardId) {
    void board.refresh();
  }
  return true;
}

export function addCardType(boardId: string, name: string, prompt: string): Promise<boolean> {
  return apply(
    boardId,
    `add ${name}`,
    () => customCardTypeAdd(boardId, name, prompt || undefined),
    false
  );
}

/** Rename a type and set its prompt ("" clears it, so the board's applies). */
export function updateCardType(
  boardId: string,
  typeId: string,
  change: { name?: string; prompt: string }
): Promise<boolean> {
  return apply(
    boardId,
    "save the type",
    () => customCardTypeUpdate(boardId, typeId, change),
    change.name !== undefined
  );
}

/** Delete a type; its cards go to `moveCardsTo` (a type's id, or "" for no type). */
export function deleteCardType(
  boardId: string,
  typeId: string,
  moveCardsTo?: string
): Promise<boolean> {
  return apply(
    boardId,
    "delete the type",
    () => customCardTypeDelete(boardId, typeId, moveCardsTo),
    true
  );
}
