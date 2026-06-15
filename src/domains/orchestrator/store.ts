import { create } from "zustand";

export type OrchTab = "stats" | "chat";

interface OrchestratorStore {
  open: boolean;
  tab: OrchTab;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setTab: (tab: OrchTab) => void;
}

// UI state for the orchestrator panel (the slide-out assistant). Chat
// conversation state lands in a separate slice in Phase 2.
export const useOrchestratorStore = create<OrchestratorStore>((set) => ({
  open: false,
  tab: "stats",
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setTab: (tab) => set({ tab }),
}));
