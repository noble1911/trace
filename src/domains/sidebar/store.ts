import { create } from "zustand";
import type { NavId } from "@/app/nav";
import { DEFAULT_SIDEBAR, type SidebarEntry, sidebarItem, type Visibility } from "./items";
import { loadSidebar, moveEntry, nudgeEntry, saveSidebar } from "./prefs";

// The rail's items as the user arranged them. Loaded once; every change is saved
// and re-renders the rail at once.

interface SidebarStore {
  entries: SidebarEntry[];
  setVisibility: (id: NavId, visibility: Visibility) => void;
  /** Drop `id` just before `before` (null = after the last movable item). */
  move: (id: NavId, before: NavId | null) => void;
  nudge: (id: NavId, delta: -1 | 1) => void;
  reset: () => void;
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
      commit(moveEntry(get().entries, id, before));
    },
    nudge(id, delta) {
      commit(nudgeEntry(get().entries, id, delta));
    },
    reset() {
      commit(DEFAULT_SIDEBAR);
    },
  };
});

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
