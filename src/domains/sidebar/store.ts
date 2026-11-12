import { create } from "zustand";
import type { NavId } from "@/app/nav";
import { loadGroupBoards, moveRow, nudgeRow, saveGroupBoards, setGroupVisible } from "./boardGroup";
import { DEFAULT_SIDEBAR, type SidebarEntry, sidebarItem, type Visibility } from "./items";
import { loadSidebar, saveSidebar } from "./prefs";
import { loadRecentsDelay, type RecentsDelay, saveRecentsDelay } from "./recentsDelay";
import { loadRecentsFlyout, saveRecentsFlyout } from "./recentsFlyout";

// The rail's items as the user arranged them. Loaded once; every change is saved
// and re-renders the rail at once.

interface SidebarStore {
  entries: SidebarEntry[];
  setVisibility: (id: NavId, visibility: Visibility) => void;
  /** Drop `id` just before `before` (null = after the last movable item). */
  move: (id: NavId, before: NavId | null) => void;
  nudge: (id: NavId, delta: -1 | 1) => void;
  reset: () => void;
  /** The board pages are one Boards button on the rail, and one row here (on by default).
   * While on, `move` and `nudge` carry the board pages together. */
  groupBoards: boolean;
  setGroupBoards: (on: boolean) => void;
  /** Show or hide the grouped board pages together. */
  setGroupVisible: (on: boolean) => void;
  /** Resting on Sessions slides out its recent sessions (off by default). */
  recentsFlyout: boolean;
  setRecentsFlyout: (on: boolean) => void;
  /** Milliseconds resting on Sessions before its recent sessions slide out. */
  recentsDelay: RecentsDelay;
  setRecentsDelay: (ms: RecentsDelay) => void;
}

export const useSidebarStore = create<SidebarStore>((set, get) => {
  const commit = (entries: SidebarEntry[]) => {
    if (entries === get().entries) return;
    saveSidebar(entries);
    set({ entries });
  };
  return {
    entries: loadSidebar(),
    setVisibility(id, visibility) {
      if (sidebarItem(id)?.isFixed) return;
      commit(get().entries.map((e) => (e.id === id ? { ...e, visibility } : e)));
    },
    move(id, before) {
      commit(moveRow(get().entries, id, before, get().groupBoards));
    },
    nudge(id, delta) {
      commit(nudgeRow(get().entries, id, delta, get().groupBoards));
    },
    groupBoards: loadGroupBoards(),
    setGroupBoards(groupBoards) {
      saveGroupBoards(groupBoards);
      set({ groupBoards });
    },
    setGroupVisible(on) {
      commit(setGroupVisible(get().entries, on));
    },
    reset() {
      commit(DEFAULT_SIDEBAR);
    },
    recentsFlyout: loadRecentsFlyout(),
    setRecentsFlyout(recentsFlyout) {
      saveRecentsFlyout(recentsFlyout);
      set({ recentsFlyout });
    },
    recentsDelay: loadRecentsDelay(),
    setRecentsDelay(recentsDelay) {
      saveRecentsDelay(recentsDelay);
      set({ recentsDelay });
    },
  };
});

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
