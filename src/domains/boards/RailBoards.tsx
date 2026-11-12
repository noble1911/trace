import { boardNav, isBoardNav, type NavId } from "@/app/nav";
import { BOARD_GROUP_ICON } from "@/app/railIcons";
import { I } from "@/components/Icon";
import { rememberedIssueBoard } from "@/domains/board/issueBoards";
import { useIssuesStore } from "@/domains/issues/store";
import type { BoardOption } from "@/domains/issues/types";
import { useLiveStore } from "@/domains/live/store";
import { TRACKER_NAMES } from "@/domains/sidebar/items";
import { BoardGlyph } from "./BoardGlyph";
import { useBoardRecency } from "./boardRecency";
import { RailBoardsMore } from "./RailBoardsMore";
import { boardInitials, boardsNeedingYou, lastUsedBoard, pickRailBoards } from "./railBoardList";
import { useBoardsUi } from "./uiStore";

interface RailBoardsProps {
  nav: NavId;
  /** Navigating from the rail: leaves any open detail first. */
  onNav: (nav: NavId) => void;
}

/** "Delivery · Jira": a board's tooltip and accessible name. */
const boardTitle = (b: BoardOption) => `${b.name} · ${TRACKER_NAMES[b.provider]}`;

// The board pages as one rail button (Settings → Sidebar's "Group boards under one
// button", on by default). It opens the board you last used; while a board is on screen
// a box beneath it lists your boards, most recently opened first (`railBoardList`), one
// button each: its glyph (`BoardGlyph`) with its initials in the corner, the shown one
// in the accent, an amber dot where an agent on it needs you. Past the limit, "All
// boards" lists every one; with room, "+" makes a new one.
export function RailBoards({ nav, onNav }: RailBoardsProps) {
  const boards = useIssuesStore((s) => s.boards);
  const selectedKey = useIssuesStore((s) => s.selectedBoardKey);
  const lastOpened = useBoardRecency((s) => s.lastOpened);
  const live = useLiveStore((s) => s.info);
  const openNameDialog = useBoardsUi((s) => s.openNameDialog);
  const active = isBoardNav(nav);

  const { shown, hasMore } = pickRailBoards(boards, lastOpened, selectedKey);
  const needsYou = boardsNeedingYou(live, rememberedIssueBoard);

  // Page and board in one step, whichever tracker it's on: the board first, so the page
  // finds its own tracker's board already chosen (`useBoardSelection`).
  const open = (b: BoardOption) => {
    useIssuesStore.getState().selectBoard(b.key);
    onNav(boardNav(b.provider));
  };
  const openLast = () => {
    const last = lastUsedBoard(boards, lastOpened, selectedKey);
    if (last) open(last);
    else onNav("boards");
  };
  const newBoard = () => openNameDialog({ mode: "new" });

  return (
    <div className="rail-group">
      <button
        type="button"
        className={`nav-btn${active ? " active" : ""}`}
        onClick={openLast}
        title="Boards"
        aria-label="Boards"
      >
        <BOARD_GROUP_ICON size={16} />
      </button>
      {active && (
        <div className="rb-box">
          {shown.map((b) => {
            const isSelected = b.key === selectedKey;
            const isWaiting = needsYou.has(b.key);
            const initials = boardInitials(b.name);
            return (
              <button
                key={b.key}
                type="button"
                className={`rb-btn${isSelected ? " active" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                title={boardTitle(b)}
                aria-label={isWaiting ? `${boardTitle(b)}, needs you` : boardTitle(b)}
                onClick={() => open(b)}
              >
                <BoardGlyph board={b} size={14} />
                {initials && (
                  <span className="rb-initials" aria-hidden="true">
                    {initials}
                  </span>
                )}
                {isWaiting && <span className="badge" aria-hidden="true" />}
              </button>
            );
          })}
          {hasMore ? (
            <RailBoardsMore
              boards={boards}
              selectedKey={selectedKey}
              onOpen={open}
              onNew={newBoard}
            />
          ) : (
            <button
              type="button"
              className="rb-btn rb-add"
              title="New board…"
              aria-label="New board…"
              onClick={newBoard}
            >
              <I.Plus size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
