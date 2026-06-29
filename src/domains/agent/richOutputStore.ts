import { create } from "zustand";
import { loadRichOutput, saveRichOutput } from "@/ipc/richOutput";

/** One rendered HTML card. `html` is raw — RichOutputPanel renders it inside a
 *  sandboxed <iframe>, which is the isolation boundary (no scripts, opaque origin). */
export interface HtmlBlock {
  id: number;
  html: string;
}

interface RichOutputState {
  /** HTML cards, keyed by issue key (one panel per agent). */
  blocks: Record<string, HtmlBlock[]>;
  /** True once the persisted cards have been loaded from disk. */
  hydrated: boolean;
  /** Load saved cards from disk once at startup. */
  hydrate: () => Promise<void>;
  /** Append `html` as a new card for `issueKey` (and persist). */
  push: (issueKey: string, html: string) => void;
  /** Drop all cards for an issue (and persist). */
  clear: (issueKey: string) => void;
}

// Monotonic id so React keys stay stable as cards accumulate. Module-scoped
// (not store state) because it must never reset when a key is cleared; hydrate
// advances it past any persisted id so a fresh card can't collide.
let nextId = 0;

// Cards persist to disk so they survive stopping/starting the agent and app
// reloads/restarts. Best-effort — a failed write just means this session's cards
// aren't durable, never a thrown error into the UI.
function persist(blocks: Record<string, HtmlBlock[]>) {
  void saveRichOutput(blocks).catch(() => {});
}

export const useRichOutputStore = create<RichOutputState>((set, get) => ({
  blocks: {},
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    const loaded = await loadRichOutput().catch(() => ({}) as Record<string, HtmlBlock[]>);
    for (const list of Object.values(loaded)) {
      for (const b of list) nextId = Math.max(nextId, b.id + 1);
    }
    set((s) => {
      // Merge, not replace: any card pushed while the async load was in flight
      // lives in `s.blocks` and must win for its key (else it's lost, and its disk
      // write clobbered). Re-persist only if such a race actually happened.
      const blocks = { ...loaded, ...s.blocks };
      if (Object.keys(s.blocks).length > 0) persist(blocks);
      return { blocks, hydrated: true };
    });
  },
  push: (issueKey, html) =>
    set((s) => {
      const block: HtmlBlock = { id: nextId++, html };
      const prev = s.blocks[issueKey] ?? [];
      const blocks = { ...s.blocks, [issueKey]: [...prev, block] };
      persist(blocks);
      return { blocks };
    }),
  clear: (issueKey) =>
    set((s) => {
      const next = { ...s.blocks };
      delete next[issueKey];
      persist(next);
      return { blocks: next };
    }),
}));
