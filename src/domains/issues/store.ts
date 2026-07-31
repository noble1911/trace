import { create } from "zustand";
import {
  connectJira,
  connectPylon,
  disconnectProvider,
  listBoards,
  providerCurrentUser,
  providerSessions,
} from "@/ipc/issues";
import {
  type BoardOption,
  boardOptionKey,
  type IssueUser,
  type ProviderKind,
  type ProviderSession,
} from "./types";

const SELECTED_BOARD_KEY = "trace.selectedBoardKey";

interface IssuesStore {
  /** Connected providers, keyed by kind. Empty = show the login gate. */
  sessions: Partial<Record<ProviderKind, ProviderSession>>;
  users: Partial<Record<ProviderKind, IssueUser>>;
  /** Boards from all connected providers, merged for the switcher. */
  boards: BoardOption[];
  selectedBoardKey: string | null;
  connecting: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  connectJira: (site: string, email: string, token: string) => Promise<void>;
  connectPylon: (token: string) => Promise<void>;
  disconnect: (provider: ProviderKind) => Promise<void>;
  selectBoard: (key: string) => void;
}

function restoreBoardKey(boards: BoardOption[]): string | null {
  const saved = localStorage.getItem(SELECTED_BOARD_KEY);
  if (saved && boards.some((b) => b.key === saved)) return saved;
  return boards[0]?.key ?? null;
}

/** Fetch one provider's boards + user and fold them into the store. */
async function loadProvider(
  set: (partial: Partial<IssuesStore> | ((s: IssuesStore) => Partial<IssuesStore>)) => void,
  provider: ProviderKind
): Promise<void> {
  const [boards, user] = await Promise.all([
    listBoards(provider).catch(() => []),
    providerCurrentUser(provider).catch(() => null),
  ]);
  const options: BoardOption[] = boards.map((b) => ({
    key: boardOptionKey(provider, b.id),
    provider,
    boardId: b.id,
    name: b.name,
  }));
  set((s) => {
    const merged = [...s.boards.filter((b) => b.provider !== provider), ...options];
    const next: Partial<IssuesStore> = {
      boards: merged,
      users: user ? { ...s.users, [provider]: user } : s.users,
    };
    // Re-validate the selection — the selected board may have vanished.
    if (!merged.some((b) => b.key === s.selectedBoardKey)) {
      next.selectedBoardKey = restoreBoardKey(merged);
    }
    return next;
  });
}

export const useIssuesStore = create<IssuesStore>((set) => ({
  sessions: {},
  users: {},
  boards: [],
  selectedBoardKey: null,
  connecting: false,
  error: null,
  initialized: false,

  async init() {
    const sessions = await providerSessions();
    const map: Partial<Record<ProviderKind, ProviderSession>> = {};
    for (const s of sessions) map[s.provider] = s;
    set({ sessions: map });
    for (const s of sessions) {
      await loadProvider(set, s.provider);
    }
    set((s) => ({
      initialized: true,
      selectedBoardKey: s.selectedBoardKey ?? restoreBoardKey(s.boards),
    }));
  },

  async connectJira(site, email, token) {
    set({ connecting: true, error: null });
    try {
      const user = await connectJira(site, email, token);
      set((s) => ({
        connecting: false,
        sessions: { ...s.sessions, jira: { provider: "jira", site, email } },
        users: { ...s.users, jira: user },
      }));
      await loadProvider(set, "jira");
    } catch (err) {
      set({ connecting: false, error: String(err) });
    }
  },

  async connectPylon(token) {
    set({ connecting: true, error: null });
    try {
      const user = await connectPylon(token);
      set((s) => ({
        connecting: false,
        sessions: { ...s.sessions, pylon: { provider: "pylon" } },
        users: { ...s.users, pylon: user },
      }));
      await loadProvider(set, "pylon");
    } catch (err) {
      set({ connecting: false, error: String(err) });
    }
  },

  async disconnect(provider) {
    await disconnectProvider(provider);
    set((s) => {
      const sessions = { ...s.sessions };
      const users = { ...s.users };
      delete sessions[provider];
      delete users[provider];
      const boards = s.boards.filter((b) => b.provider !== provider);
      const selectedBoardKey =
        s.selectedBoardKey && boards.some((b) => b.key === s.selectedBoardKey)
          ? s.selectedBoardKey
          : restoreBoardKey(boards);
      return { sessions, users, boards, selectedBoardKey };
    });
  },

  selectBoard(key) {
    localStorage.setItem(SELECTED_BOARD_KEY, key);
    set({ selectedBoardKey: key });
  },
}));

/** The board option for a key, or null. Convenience for callers that need the
 * provider + boardId behind a selection. */
export function boardOptionFor(key: string | null): BoardOption | null {
  if (!key) return null;
  return useIssuesStore.getState().boards.find((b) => b.key === key) ?? null;
}
