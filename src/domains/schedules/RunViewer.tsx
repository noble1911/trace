import { useEffect, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import { PtyTerminal } from "@/domains/agent/PtyTerminal";
import { disposeTerminal, fitTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import { resizeAgent } from "@/ipc/agent";
import { formatDuration, formatWhen } from "./describe";
import { useNow } from "./hooks/useNow";
import { runWorkspaceId } from "./ids";
import { RunBadge, useRunNeedsYou } from "./RunBadge";
import { RunConversation } from "./RunConversation";
import { useSchedulesStore } from "./store";
import type { ScheduleRun } from "./types";

type RunView = "summary" | "log" | "terminal";

// One run, three ways, one tab at a time so each gets the full height: Claude's
// closing summary (the default for a finished run — it's the answer), the whole
// conversation as scrollable text (read from Claude's own log, since the PTY
// recording can only replay the TUI's last screen), or the terminal itself,
// which a live run can be typed into, e.g. to answer a permission prompt.
export function RunViewer({ run }: { run: ScheduleRun }) {
  const ws = runWorkspaceId(run.id);
  const live = run.status === "running";
  const ptyUp = useBoardStore((s) => s.runningAgents.has(ws));
  const stopRun = useSchedulesStore((s) => s.stopRun);
  const continueAsSession = useSchedulesStore((s) => s.continueAsSession);
  const needsYou = useRunNeedsYou(run);
  const now = useNow(live ? 1000 : null);
  // A live run you may need to answer opens on the terminal; a finished one on
  // its summary; otherwise the conversation.
  const [picked, setView] = useState<RunView>(
    live && !run.claudeSessionId ? "terminal" : run.summary ? "summary" : "log"
  );
  // The Summary tab only exists once there is one.
  const view: RunView = picked === "summary" && !run.summary ? "log" : picked;

  // The backend spawns runs at a default size. If this pane was already open
  // while the run was starting, its size went nowhere — push it once the PTY
  // comes up. Only on that transition: a pane opened on an already-live run was
  // sized by PtyTerminal, and a same-size resize makes the TUI repaint over itself.
  const wasUp = useRef(ptyUp);
  useEffect(() => {
    if (ptyUp && !wasUp.current) {
      const size = fitTerminal(ws);
      if (size) void resizeAgent(ws, size.cols, size.rows);
    }
    wasUp.current = ptyUp;
  }, [ptyUp, ws]);

  // A finished run's terminal is just a replay — free it on the way out rather
  // than keeping an xterm per run ever viewed. (A live one stays, like any agent.)
  useEffect(
    () => () => {
      if (!useBoardStore.getState().runningAgents.has(ws)) disposeTerminal(ws);
    },
    [ws]
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
              <I.X size={13} /> Stop
            </button>
          )}
          {!live && run.claudeSessionId && (
            <button
              type="button"
              className="btn"
              onClick={onContinue}
              title="Open this run's conversation as a session in the prompt's worktree"
            >
              <I.Chat size={13} /> Continue as session
            </button>
          )}
        </div>
      </div>

      {needsYou && (
        <div className="sched-viewer-note">
          Claude is waiting on you — answer in the terminal below and the run carries on.
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
      <div className="sched-views">
        {run.summary && (
          <button
            type="button"
            className={`sched-view${view === "summary" ? " active" : ""}`}
            onClick={() => setView("summary")}
            title="Claude's closing message for this run"
          >
            <I.Sparkles size={12} /> Summary
          </button>
        )}
        <button
          type="button"
          className={`sched-view${view === "log" ? " active" : ""}`}
          onClick={() => setView("log")}
        >
          <I.Chat size={12} /> Conversation
        </button>
        <button
          type="button"
          className={`sched-view${view === "terminal" ? " active" : ""}`}
          onClick={() => setView("terminal")}
          title={
            live ? "Type here to answer the agent" : "The recorded terminal (last screen only)"
          }
        >
          <I.Terminal size={12} /> Terminal
        </button>
      </div>

      {view === "summary" && run.summary && (
        <div className="sched-summary">
          <Markdown text={run.summary} />
        </div>
      )}
      {view === "log" && run.claudeSessionId && <RunConversation run={run} />}
      {view === "log" && !run.claudeSessionId && (
        <div className="empty-state">
          <div className="inner">
            <div className="title">No conversation</div>
            <div className="hint">This run never got as far as starting one.</div>
          </div>
        </div>
      )}
      {view === "terminal" &&
        (live || run.hasTranscript ? (
          <div className="pty-host-wrap">
            <PtyTerminal issueKey={ws} />
          </div>
        ) : (
          <div className="empty-state">
            <div className="inner">
              <div className="title">No output recorded</div>
              <div className="hint">This run ended before its agent printed anything.</div>
            </div>
          </div>
        ))}
    </div>
  );
}
