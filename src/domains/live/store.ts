import { create } from "zustand";
import { moveId, nudgeId } from "./order";
import { loadManualOrder, saveManualOrder } from "./prefs";
import type { LiveInfo } from "./types";

// Live state for every running agent (not shells), keyed by workspace id. The
// board store owns the raw signals (running set, activity, acknowledgements);
// `sync.ts` derives this from them plus the hooks' asks, so every surface reads
// one light per agent instead of re-deriving it.

interface LiveStore {
  info: Record<string, LiveInfo>;
  /** The user's dragged order; `null` = opened order. */
  manualOrder: string[] | null;
  /** Replace the whole map — `sync.ts` only. */
  replace: (info: Record<string, LiveInfo>) => void;
  /** Patch one agent's entry — `sync.ts` only. */
  patch: (workspaceId: string, patch: Partial<LiveInfo>) => void;
  /** Drag `id` to just before `before` (null = the end), given the order on screen. */
  move: (shown: string[], id: string, before: string | null) => void;
  /** Keyboard reorder: one place up or down. */
  nudge: (shown: string[], id: string, by: -1 | 1) => void;
  /** Back to opened order. */
  resetOrder: () => void;
  /** Drop stopped agents from the dragged order — `sync.ts` only. */
  forget: (ids: string[]) => void;
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export const useLiveStore = create<LiveStore>((set) => ({
  info: {},
  manualOrder: loadManualOrder(),
  replace(info) {
    set({ info });
  },
  patch(workspaceId, patch) {
    set((s) => {
      const prev = s.info[workspaceId];
      if (!prev) return {};
      return { info: { ...s.info, [workspaceId]: { ...prev, ...patch } } };
    });
  },
  move(shown, id, before) {
    // A drop back where it started isn't a reorder — don't pin opened order.
    const order = moveId(shown, id, before);
    if (sameOrder(order, shown)) return;
    saveManualOrder(order);
    set({ manualOrder: order });
  },
  nudge(shown, id, by) {
    const order = nudgeId(shown, id, by);
    if (sameOrder(order, shown)) return;
    saveManualOrder(order);
    set({ manualOrder: order });
  },
  forget(ids) {
    set((s) => {
      if (!s.manualOrder?.some((id) => ids.includes(id))) return {};
      const manualOrder = s.manualOrder.filter((id) => !ids.includes(id));
      saveManualOrder(manualOrder);
      return { manualOrder };
    });
  },
  resetOrder() {
    saveManualOrder(null);
    set({ manualOrder: null });
  },
}));

/** One agent's light — `stopped` when trace isn't running it. */
export function useAgentLight(workspaceId: string) {
  return useLiveStore((s) => s.info[workspaceId]?.light ?? "stopped");
}
