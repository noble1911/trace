import { toast } from "@/app/toast";
import { findCustomBoard } from "@/domains/boards/findCard";
import { useIssuesStore } from "@/domains/issues/store";
import { trackerForIssueKey } from "@/domains/issues/types";
import { rememberedIssueBoard } from "./issueBoards";
import { useBoardStore } from "./store";

const isOnLoadedBoard = (issueKey: string) =>
  useBoardStore.getState().data?.issues.some((i) => i.key === issueKey) ?? false;

/** Resolves once `boardKey` has finished loading, or the user has left this ticket. */
function boardSettled(boardKey: string, issueKey: string): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useBoardStore.subscribe(check);
    function check() {
      const s = useBoardStore.getState();
      if ((s.boardKey === boardKey && !s.loading) || s.selectedIssueKey !== issueKey) {
        unsubscribe();
        resolve();
      }
    }
    check();
  });
}

/**
 * Open a ticket whichever board it's on. A ticket's detail needs its board loaded, and
 * an agent's ticket may be on another board or tracker than the one on screen, so load
 * the likely boards until it turns up. Only the likely ones: loading a board is slow,
 * and an account can have hundreds.
 */
export async function openIssueAnywhere(issueKey: string): Promise<void> {
  const board = useBoardStore.getState();
  if (isOnLoadedBoard(issueKey)) {
    board.openIssue(issueKey);
    return;
  }
  const tracker = trackerForIssueKey(issueKey);
  // trace's own boards need no connection, and can all be searched for the card.
  const isCustom = tracker === "custom";
  if (!isCustom && !useIssuesStore.getState().sessions[tracker]) {
    toast.info(`Connect its tracker in Integrations to open ${issueKey}`);
    return;
  }
  const found = isCustom ? await findCustomBoard(issueKey) : null;
  const issues = useIssuesStore.getState();
  // Read again: finding a custom card awaited, and the board may have moved on.
  const { boardKey: loaded, loading } = useBoardStore.getState();
  const likely = isCustom
    ? [found]
    : [rememberedIssueBoard(issueKey), issues.savedBoardFor(tracker)];
  const candidates = likely.filter(
    (key, i, all): key is string =>
      key !== null &&
      key !== loaded &&
      all.indexOf(key) === i &&
      issues.boards.some((b) => b.key === key)
  );

  // Marked open first: the detail appears the moment its issue is loaded, and an open
  // detail keeps the page underneath from switching back to its own tracker's board.
  const previous = issues.selectedBoardKey;
  board.openIssue(issueKey);
  if (candidates.length > 0) toast.info(`Opening ${issueKey}…`);
  const isDone = () =>
    useBoardStore.getState().selectedIssueKey !== issueKey || isOnLoadedBoard(issueKey);
  // Still loading (a notification clicked at launch): it may be on this one.
  if (loading && loaded) await boardSettled(loaded, issueKey);
  if (isDone()) return;
  for (const key of candidates) {
    useIssuesStore.setState({ selectedBoardKey: key });
    await boardSettled(key, issueKey);
    if (isDone()) return;
  }
  useBoardStore.getState().closeIssue();
  useIssuesStore.setState({ selectedBoardKey: previous });
  toast.info(`Couldn't find ${issueKey} on your boards. It may have been closed or moved.`);
}
