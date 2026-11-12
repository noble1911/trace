import { useEffect } from "react";
import { useBoardStore } from "@/domains/board/store";
import { useBoardRecency } from "@/domains/boards/boardRecency";
import { useIssuesStore } from "@/domains/issues/store";
import { type NavId, navBoardProvider } from "./nav";

/** Keep the loaded board in step with the page: a tracker's page shows that tracker's
 * board, and with no selection (Boards with none made, or a tracker disconnected) the old
 * cards don't linger. Clearing only hides them: the other boards' snapshots stay for going
 * back (`boardCache`), and disconnecting forgets them (`issues/store`). */
export function useBoardSelection(nav: NavId): void {
  const initialized = useIssuesStore((s) => s.initialized);
  const boards = useIssuesStore((s) => s.boards);
  const selectedBoardKey = useIssuesStore((s) => s.selectedBoardKey);
  const selectProvider = useIssuesStore((s) => s.selectProvider);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const clearBoard = useBoardStore((s) => s.clearBoard);
  // An open ticket can be on another tracker's board (`openIssueAnywhere`). Leave that
  // board loaded while it's open, and switch back to this page's when it closes.
  const detailOpen = useBoardStore((s) => s.selectedIssueKey !== null);
  const tracker = navBoardProvider(nav);

  // Depends on `boards` so this resolves again once a tracker's boards have loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `boards` is the trigger, read through the store
  useEffect(() => {
    if (initialized && tracker && !detailOpen) selectProvider(tracker);
  }, [initialized, tracker, boards, detailOpen, selectProvider]);

  useEffect(() => {
    if (selectedBoardKey != null) void loadBoard(selectedBoardKey);
    else clearBoard();
  }, [selectedBoardKey, loadBoard, clearBoard]);

  // A board counts as opened when its own page shows it: not one loaded behind a ticket
  // from elsewhere. The rail's Boards group lists boards by this (`boardRecency`).
  const shownProvider = boards.find((b) => b.key === selectedBoardKey)?.provider;
  const opened = tracker && !detailOpen && shownProvider === tracker ? selectedBoardKey : null;
  useEffect(() => {
    if (opened) useBoardRecency.getState().touch(opened);
  }, [opened]);
}
