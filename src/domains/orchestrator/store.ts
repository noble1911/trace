import { create } from "zustand";

export type OrchTab = "stats" | "chat";

/** How the assistant reaches Claude: the in-renderer SDK (API key) or the
 * Claude CLI in print mode (`-p`, uses the logged-in CLI). */
export type OrchBackend = "sdk" | "cli";

/** Speed/quality trade: `fast` = Sonnet, no extended thinking; `thorough` =
 * Opus + adaptive thinking. */
export type OrchSpeed = "fast" | "thorough";

const GOAL_KEY = "trace.sprintGoal";
const BACKEND_KEY = "trace.orchBackend";
const SPEED_KEY = "trace.orchSpeed";

/** Resolve the API model id (SDK) and CLI alias for a speed setting. */
export function speedModels(speed: OrchSpeed): { sdk: string; cli: string; thinking: boolean } {
  return speed === "thorough"
    ? { sdk: "claude-opus-4-8", cli: "opus", thinking: true }
    : { sdk: "claude-sonnet-4-6", cli: "sonnet", thinking: false };
}

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

function loadSpeed(): OrchSpeed {
  try {
    return localStorage.getItem(SPEED_KEY) === "thorough" ? "thorough" : "fast";
  } catch {
    return "fast";
  }
}

interface OrchestratorStore {
  open: boolean;
  tab: OrchTab;
  /** The user's stated objective for the sprint — frames the assistant's advice. */
  sprintGoal: string;
  /** Which Claude transport the assistant uses. */
  backend: OrchBackend;
  /** Speed/quality trade for the assistant's model + thinking. */
  speed: OrchSpeed;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setTab: (tab: OrchTab) => void;
  setSprintGoal: (goal: string) => void;
  setBackend: (backend: OrchBackend) => void;
  setSpeed: (speed: OrchSpeed) => void;
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
  speed: loadSpeed(),
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
  setSpeed: (speed) => {
    try {
      localStorage.setItem(SPEED_KEY, speed);
    } catch {
      // best-effort persistence
    }
    set({ speed });
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
