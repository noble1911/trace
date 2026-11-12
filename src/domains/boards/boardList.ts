import { toast } from "@/app/toast";
import { useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import { boardOptionKey } from "@/domains/issues/types";
import type { BoardSettings } from "@/ipc/boardSettings";
import { customBoardCreate, deleteCustomBoard, renameCustomBoard } from "@/ipc/customBoards";
import type { BoardRepos } from "./settings/repoChoice";
import { useBoardSetup } from "./settings/store";
import { type BoardTemplateDef, templatePayload } from "./templates";
import { useBoardsUi } from "./uiStore";

// Making, renaming and deleting custom boards. The switcher's list is the issues
// store's, so each change re-lists the custom boards from the backend rather than
// patching a copy, then says which one to show.

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

/**
 * Make a board from a template and show it, then save its brief and repos. False (with
 * a toast) when it couldn't be made. Settings that don't save leave the board made: the
 * toast says why and its settings open, filled in, to try again.
 */
export async function createBoard(
  name: string,
  template: BoardTemplateDef,
  repos: BoardRepos
): Promise<boolean> {
  let key: string;
  try {
    const board = await customBoardCreate(name, templatePayload(template));
    key = boardOptionKey("custom", board.id);
    const issues = useIssuesStore.getState();
    await issues.reloadBoards("custom");
    issues.selectBoard(key);
  } catch (err) {
    toast.error(`Couldn't make the board: ${reason(err)}`);
    return false;
  }
  const settings: BoardSettings = { kickoffPrompt: template.prompt, ...repos };
  // Nothing to save is the defaults: no call, so nothing to fail.
  if (!settings.kickoffPrompt && settings.repos.length === 0) return true;
  try {
    await useBoardSetup.getState().saveSettings(key, settings);
  } catch (err) {
    toast.error(`Made ${name}, but couldn't save its settings: ${reason(err)}`);
    useBoardsUi.getState().openSettings({ boardKey: key, draft: settings });
  }
  return true;
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
