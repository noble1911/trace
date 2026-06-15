import { create } from "zustand";

export type OrchTab = "stats" | "chat";

const GOAL_KEY = "trace.sprintGoal";

function loadGoal(): string {
  try {
    return localStorage.getItem(GOAL_KEY) ?? "";
  } catch {
    return "";
  }
}

interface OrchestratorStore {
  open: boolean;
  tab: OrchTab;
  /** The user's stated objective for the sprint — frames the assistant's advice. */
  sprintGoal: string;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setTab: (tab: OrchTab) => void;
  setSprintGoal: (goal: string) => void;
}

// State updates immediately (the assistant reads the goal live); persistence is
// debounced so typing doesn't hit localStorage on every keystroke.
let goalSaveTimer: ReturnType<typeof setTimeout> | null = null;

// UI + lightweight settings state for the orchestrator panel. The chat
// conversation lives in its own slice (chatStore).
export const useOrchestratorStore = create<OrchestratorStore>((set) => ({
  open: false,
  tab: "stats",
  sprintGoal: loadGoal(),
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setTab: (tab) => set({ tab }),
  setSprintGoal: (goal) => {
    set({ sprintGoal: goal });
    if (goalSaveTimer) clearTimeout(goalSaveTimer);
    goalSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(GOAL_KEY, goal);
      } catch {
        // best-effort persistence
      }
    }, 400);
  },
}));
