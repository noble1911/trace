import { create } from "zustand";
import { DEFAULT_MODEL, migrateModel } from "./model";

export type OrchTab = "chat" | "stats";

/** How the assistant reaches Claude: the in-renderer SDK (API key) or the
 * Claude CLI in print mode (`-p`, uses the logged-in CLI). */
export type OrchBackend = "sdk" | "cli";

const GOAL_KEY = "trace.sprintGoal";
const BACKEND_KEY = "trace.orchBackend";
const MODEL_KEY = "trace.orchModel";
/** The old Fast/Thorough setting, read once to pick the closest model. */
const LEGACY_SPEED_KEY = "trace.orchSpeed";

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

function loadModel(): string {
  try {
    return migrateModel(localStorage.getItem(MODEL_KEY), localStorage.getItem(LEGACY_SPEED_KEY));
  } catch {
    return DEFAULT_MODEL;
  }
}

interface OrchestratorStore {
  /** Chat or Stats. Chat on every launch; kept while trace runs, so moving between
   * pages returns to the tab you left (the pane lives in the side panel; see useSidePanel). */
  tab: OrchTab;
  /** The user's stated objective for the sprint — frames the assistant's advice. */
  sprintGoal: string;
  /** Which Claude transport the assistant uses. */
  backend: OrchBackend;
  /** The assistant's model, as Claude Code names it (`opus`, `sonnet`, a full id). */
  model: string;
  setTab: (tab: OrchTab) => void;
  setSprintGoal: (goal: string) => void;
  setBackend: (backend: OrchBackend) => void;
  setModel: (model: string) => void;
}

// State updates immediately (the assistant reads the goal live); persistence is
// debounced so typing doesn't hit localStorage on every keystroke.
let goalSaveTimer: ReturnType<typeof setTimeout> | null = null;

// UI + lightweight settings state for the orchestrator pane. The chat
// conversation lives in its own slice (chatStore).
export const useOrchestratorStore = create<OrchestratorStore>((set) => ({
  tab: "chat",
  sprintGoal: loadGoal(),
  backend: loadBackend(),
  model: loadModel(),
  setTab: (tab) => set({ tab }),
  setBackend: (backend) => {
    try {
      localStorage.setItem(BACKEND_KEY, backend);
    } catch {
      // best-effort persistence
    }
    set({ backend });
  },
  setModel: (model) => {
    try {
      localStorage.setItem(MODEL_KEY, model);
    } catch {
      // best-effort persistence
    }
    set({ model });
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

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
