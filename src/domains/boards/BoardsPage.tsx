import { I, ICON_SIZE } from "@/components/Icon";
import { Board } from "@/domains/board/Board";
import { useIssuesStore } from "@/domains/issues/store";
import { useBoardsUi } from "./uiStore";

// The Boards page: trace's own boards, in the same Board as a tracker's, switched
// from the topbar. With none yet, it says what a board is for and offers to make one.
export function BoardsPage() {
  const hasBoards = useIssuesStore((s) => s.boards.some((b) => b.provider === "custom"));
  const openNameDialog = useBoardsUi((s) => s.openNameDialog);

  if (hasBoards) return <Board />;
  return (
    <div className="empty-state">
      <div className="inner">
        <span className="ic">
          <I.Kanban size={ICON_SIZE.empty} />
        </span>
        <div className="title">No boards yet</div>
        <div className="hint">
          A board of your own, for work that isn't in a tracker: write cards, arrange columns, and
          start an agent on any card, as on a Jira board.
        </div>
        <button
          type="button"
          className="btn empty-action"
          onClick={() => openNameDialog({ mode: "new" })}
        >
          New board…
        </button>
      </div>
    </div>
  );
}
