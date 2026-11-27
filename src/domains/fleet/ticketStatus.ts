import { create } from "zustand";
import { rememberedIssueBoard } from "@/domains/board/issueBoards";
import { useBoardStore } from "@/domains/board/store";
import type { StatusCategory } from "@/domains/issues/types";
import { loadBoard } from "@/domains/orchestrator/boardLookup";

// Each running ticket's status in its tracker, for Fleet: "Done" says its agent is
// safe to close. Read from the ticket's own board (the shown one, else the board it
// was started from), one fetch per board however many of its tickets run. Kept
// between visits; a ticket its board no longer shows keeps the status last seen.

export interface TicketStatus {
  name: string;
  category: StatusCategory;
}

interface TicketStatusState {
  statuses: Record<string, TicketStatus>;
  /** Re-read these tickets' boards. A refresh already running is not started twice. */
  refresh: (keys: string[]) => Promise<void>;
}

let inFlight = false;

export const useTicketStatuses = create<TicketStatusState>((set) => ({
  statuses: {},
  async refresh(keys) {
    if (inFlight || keys.length === 0) return;
    inFlight = true;
    try {
      const found: Record<string, TicketStatus> = {};
      const byBoard = new Map<string, string[]>();
      const shown = useBoardStore.getState().data?.issues ?? [];
      for (const key of keys) {
        const issue = shown.find((i) => i.key === key);
        if (issue) {
          found[key] = { name: issue.statusName, category: issue.statusCategory };
          continue;
        }
        const board = rememberedIssueBoard(key);
        if (board) byBoard.set(board, [...(byBoard.get(board) ?? []), key]);
      }
      await Promise.all(
        [...byBoard].map(async ([ref, wanted]) => {
          const board = await loadBoard(ref).catch(() => null);
          for (const issue of board?.data.issues ?? []) {
            if (wanted.includes(issue.key)) {
              found[issue.key] = { name: issue.statusName, category: issue.statusCategory };
            }
          }
        })
      );
      set((s) => ({ statuses: { ...s.statuses, ...found } }));
    } finally {
      inFlight = false;
    }
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
