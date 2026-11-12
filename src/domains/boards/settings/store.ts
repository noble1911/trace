import { create } from "zustand";
import { type BoardSettings, boardSettingsGet, boardSettingsSet } from "@/ipc/boardSettings";
import { type CustomBoardConfig, customBoardConfig } from "@/ipc/customBoards";
import { listRepos } from "@/ipc/repos";

// Boards' setup as the backend keeps it, cached: each board's settings by its switcher
// key, and each custom board's card types by its id. Read once and kept, refreshed on
// every save (the commands answer with what they saved), and read fresh at a start.
// The configured repos the pickers offer are here too, re-read whenever one opens
// (they change in Settings).

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  kickoffPrompt: null,
  repos: [],
  defaultRepo: null,
};

interface BoardSetupStore {
  settings: Record<string, BoardSettings>;
  configs: Record<string, CustomBoardConfig>;
  /** Why a board's settings couldn't be read, by key (the dialog says so). */
  settingsError: Record<string, string>;
  /** Every configured repo; null until first read. */
  repos: string[] | null;
  loadRepos: () => Promise<void>;
  /** A board's settings; null when they can't be read. Cached unless `fresh`. */
  loadSettings: (boardKey: string, fresh?: boolean) => Promise<BoardSettings | null>;
  /** Save them; throws the backend's reason. */
  saveSettings: (boardKey: string, settings: BoardSettings) => Promise<BoardSettings>;
  /** A custom board's types; null when they can't be read. Cached unless `fresh`. */
  loadConfig: (boardId: string, fresh?: boolean) => Promise<CustomBoardConfig | null>;
  /** Take a config a command just answered with. */
  setConfig: (config: CustomBoardConfig) => void;
}

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

export const useBoardSetup = create<BoardSetupStore>((set, get) => ({
  settings: {},
  configs: {},
  settingsError: {},
  repos: null,

  async loadRepos() {
    try {
      set({ repos: await listRepos() });
    } catch {
      set((s) => ({ repos: s.repos ?? [] }));
    }
  },

  async loadSettings(boardKey, fresh = false) {
    const cached = get().settings[boardKey];
    if (cached && !fresh) return cached;
    try {
      const loaded = await boardSettingsGet(boardKey);
      set((s) => {
        const { [boardKey]: _gone, ...errors } = s.settingsError;
        return { settings: { ...s.settings, [boardKey]: loaded }, settingsError: errors };
      });
      return loaded;
    } catch (err) {
      set((s) => ({ settingsError: { ...s.settingsError, [boardKey]: reason(err) } }));
      return null;
    }
  },

  async saveSettings(boardKey, next) {
    const saved = await boardSettingsSet(boardKey, next);
    set((s) => ({ settings: { ...s.settings, [boardKey]: saved } }));
    return saved;
  },

  async loadConfig(boardId, fresh = false) {
    const cached = get().configs[boardId];
    if (cached && !fresh) return cached;
    try {
      const config = await customBoardConfig(boardId);
      get().setConfig(config);
      return config;
    } catch {
      return null;
    }
  },

  setConfig(config) {
    set((s) => ({ configs: { ...s.configs, [config.id]: config } }));
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
