import { useIssuesStore } from "@/domains/issues/store";
import { boardOptionKey } from "@/domains/issues/types";
import { getBoard, listBoards } from "@/ipc/issues";

/**
 * The switcher key of the custom board holding a card, or null. Custom boards are a
 * local file, so reading each one is cheap: unlike a tracker's, they can all be asked.
 * The switcher's list is refreshed first when the board isn't in it yet (an agent
 * may have made it).
 */
export async function findCustomBoard(issueKey: string): Promise<string | null> {
  try {
    for (const board of await listBoards("custom")) {
      const data = await getBoard("custom", board.id);
      if (!data.issues.some((i) => i.key === issueKey)) continue;
      const key = boardOptionKey("custom", board.id);
      const issues = useIssuesStore.getState();
      if (!issues.boards.some((b) => b.key === key)) await issues.reloadBoards("custom");
      return key;
    }
  } catch {
    // Unreadable boards file: the caller says it couldn't find the card.
  }
  return null;
}
