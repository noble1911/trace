import { useEffect, useRef } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { PtyTerminal } from "@/domains/agent/PtyTerminal";
import { disposeTerminal, fitTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import { resizeAgent } from "@/ipc/agent";
import { formatDuration, formatWhen } from "./describe";
import { useNow } from "./hooks/useNow";
import { runWorkspaceId } from "./ids";
import { RunBadge, useRunNeedsYou } from "./RunBadge";
import { useSchedulesStore } from "./store";
import type { ScheduleRun } from "./types";

// One run's conversation. A live run is the real terminal — you can type into it,
// e.g. to answer a permission prompt. A finished one replays its saved transcript
// (served by `pty_snapshot`) and can be picked up as a session.
export function RunViewer({ run }: { run: ScheduleRun }) {
  const ws = runWorkspaceId(run.id);
  const live = run.status === "running";
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
      {run.error && <div className="sched-viewer-note error">{run.error}</div>}
      {run.skipped > 0 && (
        <div className="sched-viewer-note">
          {run.skipped === 1 ? "1 firing was" : `${run.skipped} firings were`} skipped while this
          run was going.
        </div>
      )}
      {run.prompt && (
        <details className="sched-sent">
          <summary>Prompt as sent</summary>
          <div className="sched-prompt-text">{run.prompt}</div>
        </details>
      )}

      {live || run.hasTranscript ? (
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
      )}
    </div>
  );
}
