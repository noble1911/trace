import { create } from "zustand";
import { listRecaps } from "@/ipc/recaps";
import { hasRecap, type Recap } from "./types";

// Each agent's recap, cached from `recaps.json` (written by `engine.ts`), plus
// the current visit to each workspace: when the user had last looked before
// opening it, which is what "Since you looked" counts from.

/** One visit to a workspace: the last look before it, and when it began. */
export interface Visit {
  before: number;
  start: number;
}

interface RecapStore {
  recaps: Record<string, Recap>;
  /** Whether `recaps.json` has been read (before then, a missing recap may just be unread). */
  loaded: boolean;
  /** Agents whose recap is being written right now. */
  busy: ReadonlySet<string>;
  visits: Record<string, Visit>;
  load: () => Promise<void>;
  put: (workspaceId: string, recap: Recap) => void;
  setBusy: (workspaceId: string, on: boolean) => void;
  setVisit: (workspaceId: string, visit: Visit) => void;
}

export const useRecapStore = create<RecapStore>((set) => ({
  recaps: {},
  loaded: false,
  busy: new Set(),
  visits: {},
  async load() {
    try {
      const recaps = await listRecaps();
      // A recap written while the list loaded is newer than the file's copy.
      set((s) => ({ recaps: { ...recaps, ...s.recaps }, loaded: true }));
    } catch {
      // No recaps is the fallback: the panel shows the last message as before.
      set({ loaded: true });
    }
  },
  put(workspaceId, recap) {
    set((s) => ({ recaps: { ...s.recaps, [workspaceId]: recap } }));
  },
  setBusy(workspaceId, on) {
    set((s) => {
      if (s.busy.has(workspaceId) === on) return s;
      const busy = new Set(s.busy);
      if (on) busy.add(workspaceId);
      else busy.delete(workspaceId);
      return { busy };
    });
  },
  setVisit(workspaceId, visit) {
    set((s) => ({ visits: { ...s.visits, [workspaceId]: visit } }));
  },
}));

/** An agent's written recap, or null before its first. */
export function useRecap(workspaceId: string): Recap | null {
  return useRecapStore((s) => {
    const r = s.recaps[workspaceId];
    return hasRecap(r) ? r : null;
  });
}

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
