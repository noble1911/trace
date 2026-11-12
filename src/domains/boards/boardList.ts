import { toast } from "@/app/toast";
import { useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import { boardOptionKey } from "@/domains/issues/types";
import { createCustomBoard, deleteCustomBoard, renameCustomBoard } from "@/ipc/customBoards";

// Making, renaming and deleting custom boards. The switcher's list is the issues
// store's, so each change re-lists the custom boards from the backend rather than
// patching a copy, then says which one to show.

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

/** Make a board and show it. False (with a toast) when it couldn't be made. */
export async function createBoard(name: string): Promise<boolean> {
  try {
    const board = await createCustomBoard(name);
    const issues = useIssuesStore.getState();
    await issues.reloadBoards("custom");
    issues.selectBoard(boardOptionKey("custom", board.id));
    return true;
  } catch (err) {
    toast.error(`Couldn't make the board: ${reason(err)}`);
    return false;
  }
}

export async function renameBoard(boardId: string, name: string): Promise<boolean> {
  try {
    await renameCustomBoard(boardId, name);
    await useIssuesStore.getState().reloadBoards("custom");
    // The header names the board from its data, so take the new name there too.
    const { data } = useBoardStore.getState();
    if (data?.boardId === boardId) useBoardStore.setState({ data: { ...data, boardName: name } });
    return true;
  } catch (err) {
    toast.error(`Couldn't rename the board: ${reason(err)}`);
    return false;
  }
}

/** Delete a board (refused while one of its cards' agents runs), then show another. */
export async function deleteBoard(boardId: string, name: string): Promise<void> {
  try {
    await deleteCustomBoard(boardId);
  } catch (err) {
    toast.error(`Couldn't delete ${name}: ${reason(err)}`);
    return;
  }
  const issues = useIssuesStore.getState();
  await issues.reloadBoards("custom");
  // Another custom board if there is one; none leaves the Boards page empty.
  useIssuesStore.setState({ selectedBoardKey: issues.savedBoardFor("custom") });
  toast.success(`Deleted ${name}`);
}
