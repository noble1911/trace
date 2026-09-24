import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import { agentArgs } from "@/domains/agent/defaults";
import { editorItems } from "@/domains/agent/editorItems";
import { FilesPane } from "@/domains/agent/FilesPane";
import { useWorkspaceInfo } from "@/domains/agent/hooks/useWorkspaceInfo";
import { agentLabel } from "@/domains/agent/providerLabel";
import { TerminalPane } from "@/domains/agent/TerminalPane";
import { disposeTerminal } from "@/domains/agent/terminalRegistry";
import { WorkspaceSection } from "@/domains/agent/WorkspaceSection";
import { useBoardStore } from "@/domains/board/store";
import { usePrWatch } from "@/domains/prs/hooks/usePrWatch";
import { PrRailSection } from "@/domains/prs/PrRailSection";
import { usePersistedFlag } from "@/hooks/usePersistedFlag";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
import { startSession, startSessionAgent } from "@/ipc/session";
import { AddAgentMenu } from "./AddAgentMenu";
import { AgentPane } from "./AgentPane";
import { agentRoster, agentWorkspaceIds, companionsOf, MAX_COMPANIONS } from "./agentRoster";
import { useAgentRun } from "./hooks/useAgentRun";
import { LinkTicketModal } from "./LinkTicketModal";
import { useReportPrRail } from "./recentsLayout";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** Which pane the body shows. Agent tabs all share the "agent" pane. */
type PaneId = "agent" | "files" | "terminal";

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
  // PRs any of this session's agents raised. The rail only appears once there
  // is one — until then the terminal keeps the full width.
  const turnIds = useMemo(() => roster.map((r) => r.workspaceId), [roster]);
  const prUrls = usePrWatch(session.id, turnIds);
  const [prRailOpen, togglePrRail] = usePersistedFlag("trace.sessionPrRailOpen", true);
  const showRail = prUrls.length > 0 && prRailOpen;
  useReportPrRail(showRail);
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
  // Repo + live branch for the header (the tab bar already names the agent).
  const info = useWorkspaceInfo(session.id, turnIds, run.running);
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
        toast.success(`Added a ${agentLabel(cli, provider)} agent to this session`);
      })
      .catch((err) => toast.error(String(err)));
  };

  const onRemoveAgent = () => {
    // Reached from the header's confirm button (the ⋯ menu only arms it):
    // removing an agent kills its PTY and forgets its conversation.
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
          <span className="id" title={info?.cwd}>
            {info ? [basename(info.repo), info.branch].filter(Boolean).join(" · ") : "\u00a0"}
          </span>
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
          {confirmRemove && (
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={onRemoveAgent}
                title="Stops this agent and forgets its conversation; the worktree stays"
              >
                <I.X size={13} /> Confirm remove {active.label}
              </button>
            </>
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
          <PopMenu
            trigger={({ toggle }) => <MoreTrigger toggle={toggle} label="More actions" />}
            sections={[
              { title: "Worktree", items: editorItems(session.id) },
              {
                title: "Session",
                items: [
                  ...(session.worktree
                    ? [{ label: "Link to ticket…", onSelect: () => setLinking(true) }]
                    : []),
                  ...(active.companion
                    ? [
                        {
                          label: `Remove ${active.label} agent…`,
                          danger: true,
                          onSelect: () => setConfirmRemove(true),
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
          {prUrls.length > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={togglePrRail}
              title={prRailOpen ? "Hide pull requests" : "Show pull requests"}
              aria-label={prRailOpen ? "Hide pull requests panel" : "Show pull requests panel"}
            >
              {prRailOpen ? <I.Chevron size={14} /> : <I.GitPR size={14} />}
            </button>
          )}
        </div>
      </div>

      {run.error && (
        <div style={{ padding: "8px 20px", color: "var(--c-danger)", fontSize: 12.5 }}>
          {run.error}
        </div>
      )}

      <div className={`detail-body${showRail ? "" : " no-rail"}`}>
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
        {showRail && (
          <div className="detail-right">
            <PrRailSection urls={prUrls} />
            <WorkspaceSection workspaceId={session.id} turnIds={turnIds} refreshKey={run.running} />
          </div>
        )}
      </div>
    </div>
  );
}
