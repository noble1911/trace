import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { agentArgs } from "@/domains/agent/defaults";
import { FilesPane } from "@/domains/agent/FilesPane";
import { TerminalPane } from "@/domains/agent/TerminalPane";
import { disposeTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
import { type Editor, openInEditor } from "@/ipc/editor";
import { startSession, startSessionAgent } from "@/ipc/session";
import { AddAgentMenu } from "./AddAgentMenu";
import { AgentPane } from "./AgentPane";
import { agentRoster, agentWorkspaceIds, companionsOf, MAX_COMPANIONS } from "./agentRoster";
import { useAgentRun } from "./hooks/useAgentRun";
import { LinkTicketModal } from "./LinkTicketModal";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

/** Which pane the body shows. Agent tabs all share the "agent" pane. */
type PaneId = "agent" | "files" | "terminal";

const EDITORS: { id: Editor; label: string }[] = [
  { id: "vscode", label: "VS Code" },
  { id: "intellij", label: "IntelliJ" },
  { id: "cursor", label: "Cursor" },
];

// Full-screen detail for one exploratory session. Reuses the agent detail shell
// (`.detail`), the live terminal, and the Files/Diff pane — all keyed by workspace
// id, the same contract board agents use.
//
// A session can host several agents in ONE worktree (see `agentRoster`): the agent
// it was created with, plus companions added here. Each gets its own tab, PTY and
// conversation, so work claude started can be continued by codex on the same code.
export function SessionDetail({
  session,
  onBack,
}: {
  session: ScratchSession;
  onBack: () => void;
}) {
  const [pane, setPane] = useState<PaneId>("agent");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [linking, setLinking] = useState(false);
  const rename = useSessionsStore((s) => s.rename);
  const linkToIssue = useSessionsStore((s) => s.linkToIssue);
  const addAgent = useSessionsStore((s) => s.addAgent);
  const removeAgent = useSessionsStore((s) => s.removeAgent);
  // Which agent tab is in view lives in the store: the notifier consults it to
  // decide whether a finished turn is something the user is already watching.
  const selectedAgent = useSessionsStore((s) => s.selectedAgentId);
  const selectAgent = useSessionsStore((s) => s.selectAgent);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const openIssue = useBoardStore((s) => s.openIssue);

  const roster = useMemo(() => agentRoster(session), [session]);
  // Falls back to the session's own agent, which also self-heals the selection
  // when the companion whose tab was open is removed.
  const active = roster.find((r) => r.workspaceId === selectedAgent) ?? roster[0];

  // The only difference between agents: how the backend spawns them.
  const spawn = useCallback(
    (cols: number, rows: number) =>
      active.companion
        ? startSessionAgent(session.id, active.workspaceId, cols, rows, agentArgs())
        : startSession(session.id, cols, rows, agentArgs()),
    [session.id, active.companion, active.workspaceId]
  );
  const run = useAgentRun(active.workspaceId, spawn);
  const waiting = agentActivity[active.workspaceId] === "waiting";

  // Viewing a waiting agent acknowledges it — see AgentDetail.
  useEffect(() => {
    if (waiting) ackWaiting(active.workspaceId);
  }, [waiting, active.workspaceId, ackWaiting]);

  const showAgent = (workspaceId: string) => {
    selectAgent(workspaceId);
    setPane("agent");
    setConfirmRemove(false);
  };

  const onAddAgent = (cli: AgentCli, provider?: AgentProvider) => {
    void addAgent(session.id, cli, provider)
      .then((updated) => {
        // The backend appends, so the new companion is the last one.
        const companions = companionsOf(updated);
        const added = companions[companions.length - 1];
        if (added) showAgent(added.id);
        toast.success(`Added a ${provider === "moonshot" ? "kimi" : cli} agent to this session`);
      })
      .catch((err) => toast.error(String(err)));
  };

  const onRemoveAgent = () => {
    // Two clicks: removing an agent kills its PTY and forgets its conversation.
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    const removed = active.workspaceId;
    selectAgent(session.id);
    void removeAgent(session.id, removed)
      .then(() => toast.success("Agent removed"))
      .catch((err) => toast.error(String(err)));
  };

  const onPickIssue = (issueKey: string) => {
    setLinking(false);
    linkToIssue(session.id, issueKey)
      .then(() => {
        // The PTYs were killed backend-side; drop the renderer's terminals and
        // buffers so the issue card rebuilds cleanly under its own key.
        for (const id of [...agentWorkspaceIds(session), `term:${session.id}`]) {
          setAgentRunning(id, false);
          clearOutput(id);
          disposeTerminal(id);
        }
        toast.success(`Session linked to ${issueKey}`);
        onBack();
        openIssue(issueKey);
      })
      .catch((err) => toast.error(String(err)));
  };

  // The session id is the workspace the backend opens (its worktree, or the repo
  // root before it's ever started) — same contract as a board agent.
  const openEditor = (editor: Editor) => {
    void openInEditor(session.id, editor).catch((e) => toast.error(String(e)));
  };

  const startHint = active.companion
    ? "Runs in this session's worktree — it sees everything the other agents here have written."
    : session.worktree
      ? "The agent runs in an isolated worktree for this session."
      : "The agent runs in your repo root and shares your working tree.";

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
          <span className="id">{active.label}</span>
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
          {run.running && <span className="thinking">working</span>}
          <div className="open-in" title="Open this session's worktree in an editor">
            {EDITORS.map((ed) => (
              <button
                key={ed.id}
                type="button"
                className="open-btn"
                onClick={() => openEditor(ed.id)}
                title={`Open the worktree in ${ed.label}`}
              >
                <I.Code size={12} /> {ed.label}
              </button>
            ))}
          </div>
          {active.companion && (
            <button
              type="button"
              className={`btn${confirmRemove ? " danger" : ""}`}
              onClick={onRemoveAgent}
              title="Stop this agent and remove it from the session (its conversation is forgotten; the worktree stays)"
            >
              <I.X size={13} /> {confirmRemove ? "Confirm remove" : `Remove ${active.label}`}
            </button>
          )}
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
          {run.running ? (
            <button type="button" className="btn" onClick={() => void run.stop()}>
              <I.X size={13} /> Stop {active.label}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void run.start()}>
              <I.Bolt size={13} /> Start {active.label}
            </button>
          )}
        </div>
      </div>

      {run.error && (
        <div style={{ padding: "8px 20px", color: "var(--c-danger)", fontSize: 12.5 }}>
          {run.error}
        </div>
      )}

      <div className="detail-body no-rail">
        <div className="detail-left">
          <div className="detail-tabs">
            {roster.map((entry) => {
              const live = runningAgents.has(entry.workspaceId);
              const state = live ? (agentActivity[entry.workspaceId] ?? "working") : "off";
              const selected = pane === "agent" && entry.workspaceId === active.workspaceId;
              return (
                <button
                  key={entry.workspaceId}
                  type="button"
                  className={`detail-tab${selected ? " active" : ""}`}
                  onClick={() => showAgent(entry.workspaceId)}
                  title={
                    entry.companion ? "Companion agent — same worktree" : "This session's agent"
                  }
                >
                  <I.Chat size={13} /> {entry.label}
                  <span className={`agent-dot ${state}`} />
                </button>
              );
            })}
            <AddAgentMenu
              onAdd={onAddAgent}
              disabled={companionsOf(session).length >= MAX_COMPANIONS}
            />
            <span className="detail-tab-sep" />
            <button
              type="button"
              className={`detail-tab${pane === "files" ? " active" : ""}`}
              onClick={() => setPane("files")}
            >
              <I.Code size={13} /> Files
            </button>
            <button
              type="button"
              className={`detail-tab${pane === "terminal" ? " active" : ""}`}
              onClick={() => setPane("terminal")}
            >
              <I.Terminal size={13} /> Terminal
            </button>
          </div>

          {pane === "agent" && (
            <AgentPane
              key={active.workspaceId}
              workspaceId={active.workspaceId}
              cli={active.cli}
              run={run}
              hint={startHint}
            />
          )}
          {pane === "files" && <FilesPane workspaceId={session.id} />}
          {pane === "terminal" && <TerminalPane issueKey={session.id} />}
          {linking && <LinkTicketModal onClose={() => setLinking(false)} onPick={onPickIssue} />}
        </div>
      </div>
    </div>
  );
}
