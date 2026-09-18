import { useEffect } from "react";
import { useBoardStore } from "@/domains/board/store";
import { agentRunning } from "@/ipc/agent";
import { onScheduleRun, onSchedulesChanged, type ScheduleRunEvent } from "@/ipc/events";
import { notify } from "@/ipc/notify";
import { runWorkspaceId } from "../ids";
import { useSchedulesStore } from "../store";

// Runs whose "needs input" was already announced — one ping per run, however
// many permission prompts it hits.
const announcedNeedsInput = new Set<string>();

const FINISHED_BODY = {
  succeeded: "The scheduled run finished.",
  failed: "The scheduled run failed.",
  timedOut: "The scheduled run timed out.",
} as const;

/** Longest notification body — a notification is a headline, not the report. */
const BODY_CHARS = 160;

/** The run's closing message as one plain line, for a notification body. */
function summaryLine(runId: string): string | null {
  const run = useSchedulesStore.getState().runs.find((r) => r.id === runId);
  const line = run?.summary
    .split("\n")
    .map((l) =>
      l
        .replace(/^[#>\-*\s]+/, "")
        .replace(/[*`_]/g, "")
        .trim()
    )
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > BODY_CHARS ? `${line.slice(0, BODY_CHARS - 1)}…` : line;
}

/** Tell the user a run finished / failed / needs them — unless they're watching it. */
function announce(e: ScheduleRunEvent) {
  const { prompts, openRunId } = useSchedulesStore.getState();
  const prompt = prompts.find((p) => p.id === e.promptId);
  if (!prompt?.notify) return;
  if (document.hasFocus() && openRunId === e.runId) return;
  const ws = runWorkspaceId(e.runId);
  if (e.status === "running") {
    if (!e.needsInput || announcedNeedsInput.has(e.runId)) return;
    announcedNeedsInput.add(e.runId);
    void notify(
      `${prompt.title} needs input`,
      "A scheduled run is waiting on you — probably a permission prompt.",
      ws
    );
    return;
  }
  announcedNeedsInput.delete(e.runId);
  // Stopping is the user's own doing — nothing to announce.
  if (e.status === "stopped") return;
  void notify(prompt.title, summaryLine(e.runId) ?? FINISHED_BODY[e.status], ws);
}

/**
 * Adopt the backend's truth for live runs the renderer doesn't know are running.
 * The runner can start a run before the webview is listening (at launch), and a
 * reload empties the run-state — either way `agent-run-state` was missed.
 */
function reconcileLiveRuns() {
  const board = useBoardStore.getState();
  for (const run of useSchedulesStore.getState().runs) {
    const ws = runWorkspaceId(run.id);
    if (run.status !== "running" || board.runningAgents.has(ws)) continue;
    void agentRunning(ws).then((alive) => {
      const now = useBoardStore.getState();
      if (alive && !now.runningAgents.has(ws)) now.setAgentRunning(ws, true);
    });
  }
}

/**
 * App-level sync for scheduled prompts: the backend runner starts and finishes
 * runs on its own, so the store follows its events rather than its own calls.
 * Mounted once in App, so it works whichever view is open.
 */
export function useScheduleEvents(): void {
  useEffect(() => {
    // Same late-registration guard as App's PTY listeners (StrictMode double
    // mount): a listener resolving after cleanup unregisters itself.
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    const track = (registration: Promise<() => void>) => {
      void registration.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    };
    // Re-load, then run `after` — announcing only once the store holds the run's
    // closing line, so a notification can quote it.
    const sync = (after?: () => void) =>
      void useSchedulesStore
        .getState()
        .load()
        .then(reconcileLiveRuns)
        .catch(() => {})
        .finally(() => after?.());

    sync();
    track(
      onScheduleRun((e) => {
        sync(() => announce(e));
        // A finished run's history now lives on disk (replayed on demand), so
        // the renderer's copy of its byte stream is dead weight.
        if (e.status !== "running") useBoardStore.getState().clearOutput(runWorkspaceId(e.runId));
      })
    );
    track(onSchedulesChanged(() => sync()));
    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);
}
