import { useEffect, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { agentArgs } from "@/domains/agent/defaults";
import { FilesPane } from "@/domains/agent/FilesPane";
import { PtyTerminal } from "@/domains/agent/PtyTerminal";
import { TerminalPane } from "@/domains/agent/TerminalPane";
import { disposeTerminal, fitTerminal, resetTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import { resetAgentSession, stopAgent } from "@/ipc/agent";
import { startSession } from "@/ipc/session";
import { LinkTicketModal } from "./LinkTicketModal";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

type TabId = "chat" | "files" | "terminal";

// Full-screen detail for one exploratory session. Reuses the agent detail shell
// (`.detail`), the live terminal, and the Files/Diff pane — all keyed by the
// session id, which is the same workspace-id contract board agents use.
export function SessionDetail({
  session,
  onBack,
}: {
  session: ScratchSession;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<TabId>("chat");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [linking, setLinking] = useState(false);
  const rename = useSessionsStore((s) => s.rename);
  const linkToIssue = useSessionsStore((s) => s.linkToIssue);
  const running = useBoardStore((s) => s.runningAgents.has(session.id));
  const waiting = useBoardStore((s) => s.agentActivity[session.id] === "waiting");
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const openIssue = useBoardStore((s) => s.openIssue);
  const startingRef = useRef(false);

  const onPickIssue = (issueKey: string) => {
    setLinking(false);
    linkToIssue(session.id, issueKey)
      .then(() => {
        // The PTYs were killed backend-side; drop the renderer's terminals and
        // buffers so the issue card rebuilds cleanly under its own key.
        setAgentRunning(session.id, false);
        setAgentRunning(`term:${session.id}`, false);
        disposeTerminal(session.id);
        disposeTerminal(`term:${session.id}`);
        clearOutput(session.id);
        clearOutput(`term:${session.id}`);
        toast.success(`Session linked to ${issueKey}`);
        onBack();
        openIssue(issueKey);
      })
      .catch((err) => toast.error(String(err)));
  };

  // Viewing a waiting session acknowledges it — see AgentDetail.
  useEffect(() => {
    if (waiting) ackWaiting(session.id);
  }, [waiting, session.id, ackWaiting]);

  const start = async () => {
    // See AgentDetail.start — a re-entrant start would spawn a second agent into
    // the same workspace and duplicate the terminal output.
    if (startingRef.current || running) return;
    startingRef.current = true;
    setError(null);
    // Spawn at the live terminal's measured size (it's already mounted under the
    // start overlay), mirroring the board agent flow — no spawn-time resize.
    const size = fitTerminal(session.id) ?? { cols: 80, rows: 24 };
    clearOutput(session.id);
    resetTerminal(session.id);
    try {
      await startSession(session.id, size.cols, size.rows, agentArgs());
      setAgentRunning(session.id, true);
    } catch (err) {
      setError(String(err));
      toast.error(String(err));
    } finally {
      startingRef.current = false;
    }
  };
  const stop = async () => {
    await stopAgent(session.id).catch(() => {});
    setAgentRunning(session.id, false);
    clearOutput(session.id);
  };
  const startFresh = async () => {
    await resetAgentSession(session.id).catch(() => {});
    await start();
  };

  return (
    <div className="detail detail-recents">
      <div className="detail-top">
        <button type="button" className="back" onClick={onBack}>
          <I.Back size={14} /> Sessions
        </button>
        <span className="session-avatar">
          <I.Sparkles size={18} />
        </span>
        <div>
          <span className="id">{session.cli}</span>
          {renaming ? (
            <TitleEditor
              initial={session.title}
              onSave={(title) => void rename(session.id, title)}
              onClose={() => setRenaming(false)}
            />
          ) : (
            <div className="ttl">
              {session.title}
              <button
                type="button"
                className="ttl-edit"
                onClick={() => setRenaming(true)}
                aria-label="Rename session"
                title="Rename"
              >
                <I.Pencil size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="right">
          {running && <span className="thinking">working</span>}
          {session.worktree && (
            <button
              type="button"
              className="btn"
              onClick={() => setLinking(true)}
              title="Bind this session's worktree, branch, and conversation to a Jira ticket"
            >
              <I.Ticket size={13} /> Link to ticket
            </button>
          )}
          {running ? (
            <button type="button" className="btn" onClick={stop}>
              <I.X size={13} /> Stop session
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={start}>
              <I.Bolt size={13} /> Start {session.cli}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 20px", color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>
      )}

      <div className="detail-body no-rail">
        <div className="detail-left">
          <div className="detail-tabs">
            <button
              type="button"
              className={`detail-tab${tab === "chat" ? " active" : ""}`}
              onClick={() => setTab("chat")}
            >
              <I.Chat size={13} /> Chat
            </button>
            <button
              type="button"
              className={`detail-tab${tab === "files" ? " active" : ""}`}
              onClick={() => setTab("files")}
            >
              <I.Code size={13} /> Files
            </button>
            <button
              type="button"
              className={`detail-tab${tab === "terminal" ? " active" : ""}`}
              onClick={() => setTab("terminal")}
            >
              <I.Terminal size={13} /> Terminal
            </button>
          </div>

          {tab === "chat" && (
            <div className="pty-host-wrap">
              <PtyTerminal issueKey={session.id} />
              {!running && (
                <div className="empty-state">
                  <div className="inner">
                    <span className="ic">
                      <I.Sparkles size={28} />
                    </span>
                    <div className="title">Start this exploratory session</div>
                    <div className="hint">
                      The agent runs in your repo root and shares your working tree.
                    </div>
                    <button
                      type="button"
                      className="btn primary"
                      style={{ marginTop: 6 }}
                      onClick={start}
                    >
                      <I.Bolt size={13} /> Start {session.cli}
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={startFresh}
                      title="Forget the saved conversation and begin a new one — use this if you see “session not found”."
                    >
                      Start fresh conversation
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === "files" && <FilesPane workspaceId={session.id} />}
          {tab === "terminal" && <TerminalPane issueKey={session.id} />}
          {linking && <LinkTicketModal onClose={() => setLinking(false)} onPick={onPickIssue} />}
        </div>
      </div>
    </div>
  );
}
