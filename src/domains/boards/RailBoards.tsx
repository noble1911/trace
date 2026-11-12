import { useEffect, useState } from "react";
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
import {
  boardInitials,
  boardsNeedingYou,
  isEntrySelected,
  lastUsedBoard,
  pickRailEntries,
  type RailEntry,
} from "./railBoardList";
import { useBoardsUi } from "./uiStore";

interface RailBoardsProps {
  nav: NavId;
  /** Navigating from the rail: leaves any open detail first. */
  onNav: (nav: NavId) => void;
}

/** A button's tooltip and accessible name: "Jira · Delivery" for a tracker's (its
 * last-used board), "Roadmap · trace board" for one of trace's own. */
const entryTitle = ({ board, isTracker }: RailEntry) =>
  isTracker
    ? `${TRACKER_NAMES[board.provider]} · ${board.name}`
    : `${board.name} · ${TRACKER_NAMES[board.provider]}`;

// The board pages as one rail button (Settings → Sidebar's "Group boards under one
// button", on by default). The first click opens the board you last used. On a board
// page, clicking it again opens a box beneath it, and again closes it; leaving the
// board pages closes it too. The box has one button per kind of board
// (`railBoardList`): Jira and Pylon once each, however many boards they have (the
// topbar's switcher picks among those), then each board kept in trace, with its glyph
// (`BoardGlyph`) and initials. The one on screen is in the accent; an amber dot marks
// one where an agent needs you. "All boards" lists every board by name; with nothing
// left out, "+" makes a new one.
export function RailBoards({ nav, onNav }: RailBoardsProps) {
  const boards = useIssuesStore((s) => s.boards);
  const selectedKey = useIssuesStore((s) => s.selectedBoardKey);
  const lastOpened = useBoardRecency((s) => s.lastOpened);
  const live = useLiveStore((s) => s.info);
  const openNameDialog = useBoardsUi((s) => s.openNameDialog);
  const active = isBoardNav(nav);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!active) setIsOpen(false);
  }, [active]);

  const { shown, hasMore } = pickRailEntries(boards, lastOpened, selectedKey);
  const selected = boards.find((b) => b.key === selectedKey);
  const needsYou = boardsNeedingYou(live, rememberedIssueBoard);

  // Page and board in one step, whichever tracker it's on: the board first, so the page
  // finds its own tracker's board already chosen (`useBoardSelection`).
  const open = (b: BoardOption) => {
    useIssuesStore.getState().selectBoard(b.key);
    onNav(boardNav(b.provider));
  };
  // Off a board page: go to the last board. On one: open or close the box.
  const press = () => {
    if (active) {
      setIsOpen((was) => !was);
      return;
    }
    const last = lastUsedBoard(boards, lastOpened, selectedKey);
    if (last) open(last);
    else onNav("boards");
  };
  /** An agent needs you on this button's board, or on any of its tracker's. */
  const waitsOn = (e: RailEntry) =>
    e.isTracker
      ? boards.some((b) => b.provider === e.board.provider && needsYou.has(b.key))
      : needsYou.has(e.board.key);
  const newBoard = () => openNameDialog({ mode: "new" });

  return (
    <div className="rail-group">
      <button
        type="button"
        className={`nav-btn${active ? " active" : ""}`}
        onClick={press}
        title={active ? (isOpen ? "Hide boards" : "Show boards") : "Boards"}
        aria-label="Boards"
        aria-expanded={active ? isOpen : undefined}
      >
        <BOARD_GROUP_ICON size={16} />
      </button>
      {active && isOpen && (
        <div className="rb-box">
          {shown.map((entry) => {
            const b = entry.board;
            const isSelected = isEntrySelected(entry, selected);
            const isWaiting = waitsOn(entry);
            // A tracker's button is its type: the glyph says it all.
            const initials = entry.isTracker ? "" : boardInitials(b.name);
            const title = entryTitle(entry);
            return (
              <button
                key={entry.isTracker ? `tracker:${b.provider}` : b.key}
                type="button"
                className={`rb-btn${isSelected ? " active" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                title={title}
                aria-label={isWaiting ? `${title}, needs you` : title}
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
