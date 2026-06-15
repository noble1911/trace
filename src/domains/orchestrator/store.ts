import { create } from "zustand";

export type OrchTab = "stats" | "chat";

/** How the assistant reaches Claude: the in-renderer SDK (API key) or the
 * Claude CLI in print mode (`-p`, uses the logged-in CLI, read-only). */
export type OrchBackend = "sdk" | "cli";

const GOAL_KEY = "trace.sprintGoal";
const BACKEND_KEY = "trace.orchBackend";

function loadGoal(): string {
  try {
    return localStorage.getItem(GOAL_KEY) ?? "";
  } catch {
    return "";
  }
}

function loadBackend(): OrchBackend {
  try {
    return localStorage.getItem(BACKEND_KEY) === "cli" ? "cli" : "sdk";
  } catch {
    return "sdk";
  }
}

interface OrchestratorStore {
  open: boolean;
  tab: OrchTab;
  /** The user's stated objective for the sprint — frames the assistant's advice. */
  sprintGoal: string;
  /** Which Claude transport the assistant uses. */
  backend: OrchBackend;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setTab: (tab: OrchTab) => void;
  setSprintGoal: (goal: string) => void;
  setBackend: (backend: OrchBackend) => void;
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
  backend: loadBackend(),
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setTab: (tab) => set({ tab }),
  setBackend: (backend) => {
    try {
      localStorage.setItem(BACKEND_KEY, backend);
    } catch {
      // best-effort persistence
    }
    set({ backend });
  },
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
