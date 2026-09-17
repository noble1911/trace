import { create } from "zustand";
import { activity } from "@/domains/activity/store";
import { disposeTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";
import {
  continueRunAsSession,
  deleteScheduledPrompt,
  listScheduledPrompts,
  listScheduleRuns,
  runScheduledPromptNow,
  saveScheduledPrompt,
  setScheduledPromptEnabled,
  stopScheduledRun,
} from "@/ipc/schedules";
import { runWorkspaceId } from "./ids";
import type { PromptInput, ScheduledPrompt, ScheduleRun } from "./types";

// Prompts + run records mirrored from the backend, which owns them (the runner
// thread changes both on its own). Every mutation re-loads rather than patching
// locally, and `useScheduleEvents` re-loads on backend events. Live terminal
// state for a run sits in the board store under its `sched:` workspace id, like
// any agent's.
interface SchedulesStore {
  prompts: ScheduledPrompt[];
  /** Newest first. */
  runs: ScheduleRun[];
  loaded: boolean;
  /** The prompt whose detail is open, and the run in view within it. */
  openPromptId: string | null;
  openRunId: string | null;
  load: () => Promise<void>;
  save: (input: PromptInput) => Promise<ScheduledPrompt>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  stopRun: (runId: string) => Promise<void>;
  /** Hand a finished run to a new session and open it. */
  continueAsSession: (runId: string) => Promise<void>;
  /** Open a prompt's detail, optionally on a specific run. */
  open: (promptId: string, runId?: string | null) => void;
  /** Open whichever prompt owns a run, on that run (e.g. a notification click). */
  openRun: (runId: string) => void;
  selectRun: (runId: string) => void;
  close: () => void;
}

// Coalesce bursts (a run finishing emits run + prompt changes together).
let inflight: Promise<void> | null = null;
let again = false;

export const useSchedulesStore = create<SchedulesStore>((set, get) => ({
  prompts: [],
  runs: [],
  loaded: false,
  openPromptId: null,
  openRunId: null,
  load() {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      try {
        do {
          again = false;
          const [prompts, runs] = await Promise.all([listScheduledPrompts(), listScheduleRuns()]);
          set({ prompts, runs, loaded: true });
        } while (again);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
  async save(input) {
    const saved = await saveScheduledPrompt(input);
    await get().load();
    return saved;
  },
  async setEnabled(id, enabled) {
    await setScheduledPromptEnabled(id, enabled);
    await get().load();
  },
  async remove(id) {
    const doomed = get().runs.filter((r) => r.promptId === id);
    await deleteScheduledPrompt(id);
    // The backend killed any live PTY; drop the renderer's terminals for its runs.
    for (const run of doomed) {
      const ws = runWorkspaceId(run.id);
      useBoardStore.getState().setAgentRunning(ws, false);
      useBoardStore.getState().clearOutput(ws);
      disposeTerminal(ws);
    }
    set((s) => (s.openPromptId === id ? { openPromptId: null, openRunId: null } : {}));
    await get().load();
  },
  async runNow(id) {
    const run = await runScheduledPromptNow(id);
    await get().load();
    // Jump to the new run when its prompt is open.
    set((s) => (s.openPromptId === id ? { openRunId: run.id } : {}));
  },
  async stopRun(runId) {
    await stopScheduledRun(runId);
    await get().load();
  },
  async continueAsSession(runId) {
    const session = await continueRunAsSession(runId);
    // Two full-screen overlays can't stack — leave the schedule detail first.
    set({ openPromptId: null, openRunId: null });
    const sessions = useSessionsStore.getState();
    await sessions.load();
    sessions.select(session.id);
    activity.log({ kind: "session-created", title: `continued “${session.title}” as a session` });
  },
  open(promptId, runId) {
    // Mirrors sessions.select: one full-screen overlay at a time.
    useBoardStore.getState().closeIssue();
    useSessionsStore.getState().close();
    set({ openPromptId: promptId, openRunId: runId ?? null });
  },
  openRun(runId) {
    const run = get().runs.find((r) => r.id === runId);
    if (run) get().open(run.promptId, run.id);
  },
  selectRun(runId) {
    set({ openRunId: runId });
  },
  close() {
    set({ openPromptId: null, openRunId: null });
  },
}));
