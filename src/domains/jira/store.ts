import { create } from "zustand";
import {
  connectJira,
  disconnectJira,
  jiraCurrentUser,
  jiraSession,
  listJiraBoards,
} from "@/ipc/jira";
import type { BoardSummary, JiraSession, JiraUser } from "./types";

const SELECTED_BOARD_KEY = "trace.selectedBoardId";

interface JiraStore {
  session: JiraSession | null;
  user: JiraUser | null;
  boards: BoardSummary[];
  selectedBoardId: number | null;
  connecting: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  connect: (site: string, email: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  selectBoard: (id: number) => void;
}

function restoreBoardId(boards: BoardSummary[]): number | null {
  const saved = Number(localStorage.getItem(SELECTED_BOARD_KEY));
  if (saved && boards.some((b) => b.id === saved)) return saved;
  return boards[0]?.id ?? null;
}

export const useJiraStore = create<JiraStore>((set) => ({
  session: null,
  user: null,
  boards: [],
  selectedBoardId: null,
  connecting: false,
  error: null,
  initialized: false,

  async init() {
    const session = await jiraSession();
    if (session) {
      const [boards, user] = await Promise.all([
        listJiraBoards().catch(() => [] as BoardSummary[]),
        jiraCurrentUser().catch(() => null),
      ]);
      set({ session, user, boards, selectedBoardId: restoreBoardId(boards) });
    }
    set({ initialized: true });
  },

  async connect(site, email, token) {
    set({ connecting: true, error: null });
    try {
      const user = await connectJira(site, email, token);
      const session: JiraSession = { site, email };
      const boards = await listJiraBoards();
      set({
        user,
        session,
        boards,
        selectedBoardId: restoreBoardId(boards),
        connecting: false,
      });
    } catch (err) {
      set({ connecting: false, error: String(err) });
    }
  },

  async disconnect() {
    await disconnectJira();
    localStorage.removeItem(SELECTED_BOARD_KEY);
    set({ session: null, user: null, boards: [], selectedBoardId: null });
  },

  selectBoard(id) {
    localStorage.setItem(SELECTED_BOARD_KEY, String(id));
    set({ selectedBoardId: id });
  },
}));
