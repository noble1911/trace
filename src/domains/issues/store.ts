import { create } from "zustand";
import { toast } from "@/app/toast";
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
  /** Connected providers, keyed by kind. Each one's page is only in the rail while connected. */
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
  /** Re-list one tracker's boards: after a custom board is made, renamed or deleted. */
  reloadBoards: (provider: ProviderKind) => Promise<void>;
  selectBoard: (key: string) => void;
  /** The board last viewed on a tracker, or its first. */
  savedBoardFor: (provider: ProviderKind) => string | null;
  /** Show this tracker's board: the one last viewed there, or its first. */
  selectProvider: (provider: ProviderKind) => void;
  clearConnectError: () => void;
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
    // An expired token lands here; without the toast it just looks like an empty board.
    listBoards(provider).catch((err) => {
      toast.error(`Couldn't load your ${provider} boards: ${String(err)}`);
      return [];
    }),
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

export const useIssuesStore = create<IssuesStore>((set, get) => ({
  sessions: {},
  users: {},
  boards: [],
  selectedBoardKey: null,
  connecting: false,
  error: null,
  initialized: false,

  async init() {
    // A tracker is optional, so failing to restore one must not strand the app on
    // its splash screen: say why and carry on without it.
    try {
      const sessions = await providerSessions();
      const map: Partial<Record<ProviderKind, ProviderSession>> = {};
      for (const s of sessions) map[s.provider] = s;
      set({ sessions: map });
      for (const s of sessions) {
        await loadProvider(set, s.provider);
      }
    } catch (err) {
      toast.error(`Couldn't restore your tracker connections: ${String(err)}`);
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
        sessions: { ...s.sessions, jira: { provider: "jira", via: "api", site, email } },
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
        sessions: { ...s.sessions, pylon: { provider: "pylon", via: "api" } },
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

  async reloadBoards(provider) {
    await loadProvider(set, provider);
  },

  selectBoard(key) {
    localStorage.setItem(SELECTED_BOARD_KEY, key);
    const provider = get().boards.find((b) => b.key === key)?.provider;
    if (provider) localStorage.setItem(`${SELECTED_BOARD_KEY}.${provider}`, key);
    set({ selectedBoardKey: key });
  },

  savedBoardFor(provider) {
    const own = get().boards.filter((b) => b.provider === provider);
    const saved = [
      localStorage.getItem(`${SELECTED_BOARD_KEY}.${provider}`),
      localStorage.getItem(SELECTED_BOARD_KEY),
    ];
    return (own.find((b) => saved.includes(b.key)) ?? own[0])?.key ?? null;
  },

  selectProvider(provider) {
    const { boards, selectedBoardKey, savedBoardFor } = get();
    if (boards.some((b) => b.provider === provider && b.key === selectedBoardKey)) return;
    // No boards here means no selection, never another tracker's board under this one's page.
    set({ selectedBoardKey: savedBoardFor(provider) });
  },

  clearConnectError() {
    set({ error: null });
  },
}));

/** The board option for a key, or null. Convenience for callers that need the
 * provider + boardId behind a selection. */
export function boardOptionFor(key: string | null): BoardOption | null {
  if (!key) return null;
  return useIssuesStore.getState().boards.find((b) => b.key === key) ?? null;
}

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
