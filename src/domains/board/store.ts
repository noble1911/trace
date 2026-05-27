import { create } from "zustand";
import type { BoardColumn, BoardData } from "@/domains/jira/types";
import { getJiraBoard, transitionJiraIssue } from "@/ipc/jira";

export type BoardFilter = "all" | "active" | "running";

interface BoardStore {
  boardId: number | null;
  data: BoardData | null;
  loading: boolean;
  error: string | null;
  filter: BoardFilter;

  selectedIssueKey: string | null;
  /** Issue keys with a live Claude PTY session. */
  runningAgents: Set<string>;

  loadBoard: (boardId: number) => Promise<void>;
  refresh: () => Promise<void>;
  moveIssue: (key: string, column: BoardColumn) => Promise<void>;
  openIssue: (key: string) => void;
  closeIssue: () => void;
  setFilter: (filter: BoardFilter) => void;
  setAgentRunning: (key: string, running: boolean) => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boardId: null,
  data: null,
  loading: false,
  error: null,
  filter: "all",
  selectedIssueKey: null,
  runningAgents: new Set(),

  async loadBoard(boardId) {
    set({ boardId, loading: true, error: null });
    try {
      const data = await getJiraBoard(boardId);
      set({ data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  async refresh() {
    const { boardId } = get();
    if (boardId != null) await get().loadBoard(boardId);
  },

  async moveIssue(key, column) {
    const { data } = get();
    if (!data || column.statusIds.length === 0) return;

    // Optimistically re-home the card into the target column.
    const snapshot = data.issues;
    const target = column.statusIds[0];
    set({
      data: {
        ...data,
        issues: data.issues.map((i) => (i.key === key ? { ...i, statusId: target } : i)),
      },
    });

    try {
      await transitionJiraIssue(key, column.statusIds);
      await get().refresh();
    } catch (err) {
      // Revert and surface the workflow error.
      const current = get().data;
      if (current) set({ data: { ...current, issues: snapshot }, error: String(err) });
    }
  },

  openIssue(key) {
    set({ selectedIssueKey: key });
  },
  closeIssue() {
    set({ selectedIssueKey: null });
  },
  setFilter(filter) {
    set({ filter });
  },
  setAgentRunning(key, running) {
    const next = new Set(get().runningAgents);
    if (running) next.add(key);
    else next.delete(key);
    set({ runningAgents: next });
  },
}));
