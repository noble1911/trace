import { useEffect, useRef } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { disposeTerminal, fitTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import { useNow } from "@/hooks/useNow";
import { resizeAgent } from "@/ipc/agent";
import { formatDuration, formatWhen } from "./describe";
import { runWorkspaceId } from "./ids";
import { PrecheckNote, stoppedAtPrecheck } from "./PrecheckNote";
import { RunBadge, useRunNeedsYou } from "./RunBadge";
import { RunViews } from "./RunViews";
import { useSchedulesStore } from "./store";
import type { ScheduledPrompt, ScheduleRun } from "./types";

// One run: its facts and notes over its views (`RunViews`): Claude's closing
// summary, the conversation, the terminal or the chat, and the prompt.
export function RunViewer({ run, prompt }: { run: ScheduleRun; prompt: ScheduledPrompt }) {
  const ws = runWorkspaceId(run.id);
  const live = run.status === "running";
  const chat = run.transport === "chat";
  const ptyUp = useBoardStore((s) => s.runningAgents.has(ws));
  const stopRun = useSchedulesStore((s) => s.stopRun);
  const continueAsSession = useSchedulesStore((s) => s.continueAsSession);
  const needsYou = useRunNeedsYou(run);
  const now = useNow(live ? 1000 : null);

  // The backend spawns runs at a default size. If this pane was already open
  // while the run was starting, its size went nowhere — push it once the PTY
  // comes up. Only on that transition: a pane opened on an already-live run was
  // sized by PtyTerminal, and a same-size resize makes the TUI repaint over itself.
  const wasUp = useRef(ptyUp);
  useEffect(() => {
    if (ptyUp && !wasUp.current && !chat) {
      const size = fitTerminal(ws);
      if (size) void resizeAgent(ws, size.cols, size.rows);
    }
    wasUp.current = ptyUp;
  }, [ptyUp, ws, chat]);

  // A finished run's terminal is just a replay — free it on the way out rather
  // than keeping an xterm per run ever viewed. (A live one stays, like any agent.)
  useEffect(
    () => () => {
      if (!chat && !useBoardStore.getState().runningAgents.has(ws)) disposeTerminal(ws);
    },
    [ws, chat]
  );

  const onContinue = () => {
    void continueAsSession(run.id)
      .then(() => toast.success("Opened as a session — Start resumes the conversation"))
      .catch((err) => toast.error(String(err)));
  };

  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const background = run.backgroundTasks;
  const tasks = background === 1 ? "1 background task" : `${background} background tasks`;
  const facts = [
    `Started ${formatWhen(run.startedAt)}`,
    formatDuration(elapsed),
    run.trigger === "manual" ? "run by hand" : null,
  ].filter(Boolean);

  return (
    <div className="sched-viewer">
      <div className="sched-viewer-bar">
        <RunBadge run={run} />
        <span className="sched-viewer-facts">{facts.join(" · ")}</span>
        <div className="right">
          {live && (
            <button
              type="button"
              className="btn"
              onClick={() => void stopRun(run.id).catch((e) => toast.error(String(e)))}
            >
              <I.Stop size={14} /> Stop
            </button>
          )}
          {!live && run.claudeSessionId && (
            <button
              type="button"
              className="btn"
              onClick={onContinue}
              title="Open this run's conversation as a session in the prompt's worktree"
            >
              <I.Chat size={14} /> Continue as session
            </button>
          )}
        </div>
      </div>

      {needsYou && (
        <div className="sched-viewer-note">
          Claude is waiting on you — answer in the {chat ? "chat" : "terminal"} below and the run
          carries on.
        </div>
      )}
      {live && run.wakesAt && background === 0 && !needsYou && (
        <div className="sched-viewer-note muted">
          Waiting until {formatWhen(run.wakesAt)}, when Claude checks back in. The run carries on
          from there.
        </div>
      )}
      {live && background > 0 && !needsYou && (
        <div className="sched-viewer-note muted">
          Waiting on {tasks} — the run finishes once they report back.
        </div>
      )}
      {run.status === "timedOut" && background > 0 && (
        <div className="sched-viewer-note error">
          Timed out with {tasks} still going. Prompts that fan out to agents may need a longer
          timeout (Edit).
        </div>
      )}
      {run.error && <div className="sched-viewer-note error">{run.error}</div>}
      {run.skipped > 0 && (
        <div className="sched-viewer-note">
          {run.skipped === 1 ? "1 firing was" : `${run.skipped} firings were`} skipped while this
          run was going.
        </div>
      )}
      <PrecheckNote run={run} />
      {/* A run that stopped at its precheck never had an agent to show. */}
      {!stoppedAtPrecheck(run) && <RunViews run={run} prompt={prompt} live={live} />}
    </div>
  );
}
