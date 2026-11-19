import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { useCapabilities } from "@/domains/agent/capabilities";
import { useHasExited } from "@/domains/agent/exitedStore";
import { useWorkspaceInfo } from "@/domains/agent/hooks/useWorkspaceInfo";
import { agentLabel } from "@/domains/agent/providerLabel";
import { usePrTab, useTestsTab } from "@/domains/agent/reviewTabs";
import { disposeTerminal } from "@/domains/agent/terminalRegistry";
import { useDetailKeys } from "@/domains/agent/useDetailKeys";
import { useViewerTabs } from "@/domains/agent/viewerTabs";
import { useWorkspaceTabs } from "@/domains/agent/workspaceTabs";
import { useAgentMenuItems } from "@/domains/agentChat/agentMenu";
import { useBoardStore } from "@/domains/board/store";
import { useLiveStore } from "@/domains/live/store";
import { focusedGroup } from "@/domains/panes/model";
import { PaneArea } from "@/domains/panes/PaneArea";
import { layoutItems } from "@/domains/panes/paneMenu";
import { resolvePanel } from "@/domains/panes/registry";
import { isTabOn, useOnTabs, useTabSettings } from "@/domains/panes/tabSettings";
import { type Panes, usePanes } from "@/domains/panes/usePanes";
import { usePlanTab } from "@/domains/plans/store";
import { usePrWatch } from "@/domains/prs/hooks/usePrWatch";
import { useQuickOpen } from "@/domains/quickOpen/useQuickOpen";
import { useRecapVisit } from "@/domains/recap/useRecapVisit";
import { type AgentCli, type AgentProvider, detachAgent } from "@/ipc/agent";
import { agentRoster, agentWorkspaceIds, companionsOf, MAX_COMPANIONS } from "./agentRoster";
import { useSessionAgentRun } from "./hooks/useSessionAgentRun";
import { LinkTicketModal } from "./LinkTicketModal";
import { SessionHeader } from "./SessionHeader";
import { SessionPanel } from "./SessionPanel";
import { addAgentBlocker } from "./sessionHost";
import { agentOfTab, agentTab, sessionPanels } from "./sessionPanels";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// Full-screen detail for one exploratory session. Reuses the agent detail shell
// (`.detail`), the live terminal, and the Files/Diff pane — all keyed by workspace
// id, the same contract board agents use.
//
// A session can host several agents in ONE worktree (see `agentRoster`): the agent
// it was created with, plus companions added here. Each gets its own tab, PTY and
// conversation, so work claude started can be continued by codex on the same code.
// The tabs can be arranged side by side in panes (`domains/panes`); the header
// (`SessionHeader`) acts on the agent last in focus. A failed start is a toast
// (`useAgentRun`), not a line here.

export function SessionDetail({
  session,
  onBack,
  backLabel,
}: {
  session: ScratchSession;
  onBack: () => void;
  /** The page Back returns to ("Inbox", "Sessions", …). */
  backLabel: string;
}) {
  const [linking, setLinking] = useState(false);
  const linkToIssue = useSessionsStore((s) => s.linkToIssue);
  const addAgent = useSessionsStore((s) => s.addAgent);
  const removeAgent = useSessionsStore((s) => s.removeAgent);
  // Which agent tab is in view lives in the store: the notifier consults it to
  // decide whether a finished turn is something the user is already watching.
  const selectedAgent = useSessionsStore((s) => s.selectedAgentId);
  const selectAgent = useSessionsStore((s) => s.selectAgent);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const live = useLiveStore((s) => s.info);
  const openIssue = useBoardStore((s) => s.openIssue);

  const roster = useMemo(() => agentRoster(session), [session]);
  // PRs any of this session's agents raised, shown in its Pull request tab.
  const turnIds = useMemo(() => roster.map((r) => r.workspaceId), [roster]);
  const prUrls = usePrWatch(session.id, turnIds);
  // Falls back to the session's own agent, which also self-heals the selection
  // when the companion whose tab was open is removed.
  const active = roster.find((r) => r.workspaceId === selectedAgent) ?? roster[0];
  useRecapVisit(active.workspaceId);

  const run = useSessionAgentRun(session, active);
  const disconnect = () =>
    void detachAgent(active.workspaceId).catch((e) =>
      toast.error(`Couldn't disconnect: ${String(e)}`)
    );
  const agentItems = useAgentMenuItems({
    workspaceId: active.workspaceId,
    cli: active.cli,
    running: run.running,
    restart: run.restart,
    start: run.start,
  });
  // Repo + live branch for the header (the tab bar already names the agent).
  const info = useWorkspaceInfo(session.id, turnIds, run.running);
  const waiting = agentActivity[active.workspaceId] === "waiting";
  const plan = usePlanTab(active.workspaceId);
  const viewers = useViewerTabs(active.workspaceId);
  // A plain folder has no git; a remote host has Files only if it can read its checkout.
  const caps = useCapabilities(session.id);
  const hasFiles = !session.folder && (!session.host || caps?.files === true);
  const filesOn = useTabSettings((s) => isTabOn(s.off, "files"));
  const workspace = useWorkspaceTabs(session.id, hasFiles && filesOn);
  const tests = useTestsTab(session.id);
  const pr = usePrTab(session.id, prUrls);

  // Viewing a waiting agent acknowledges it — see AgentDetail.
  useEffect(() => {
    if (waiting) ackWaiting(active.workspaceId);
  }, [waiting, active.workspaceId, ackWaiting]);

  const panels = useOnTabs(
    sessionPanels({
      session,
      roster,
      active,
      live,
      plan,
      viewers,
      workspace,
      tests,
      pr,
      prUrls,
      onAddAgent: (cli, provider) => onAddAgent(cli, provider),
      addBlocked: addAgentBlocker(session, MAX_COMPANIONS),
      hostFiles: caps?.files === true,
    })
  );
  const owners = useMemo(
    () => Object.fromEntries(turnIds.map((id) => [id, agentTab(id)])),
    [turnIds]
  );
  const panes = usePanes(`session:${session.id}`, panels, owners);
  useFollowAgent(panes, roster, selectedAgent, selectAgent);

  const showAgent = (workspaceId: string) => {
    selectAgent(workspaceId);
    panes.select(agentTab(workspaceId));
  };
  // ⌘1… = each tab in its natural order, wherever it is; Esc goes back.
  const exited = useHasExited(active.workspaceId);
  const quickOpen = useQuickOpen(session.id, hasFiles, () => panes.reveal("files"));
  useDetailKeys(
    onBack,
    panels.filter((p) => !p.hidden).map((p) => p.id),
    panes.select
  );

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
    // Reached from the header's inline confirm (the ⋯ menu only arms it):
    // removing an agent kills its PTY and forgets its conversation.
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

  return (
    <div className="detail">
      <SessionHeader
        session={session}
        backLabel={backLabel}
        onBack={onBack}
        info={info}
        active={active}
        run={run}
        exited={exited}
        onDisconnect={disconnect}
        agentItems={agentItems}
        layoutItems={layoutItems(panes)}
        onLink={() => setLinking(true)}
        onRemoveAgent={onRemoveAgent}
      />

      <div className="detail-body">
        <div className="detail-left">
          <PaneArea panes={panes} />
          {linking && <LinkTicketModal onClose={() => setLinking(false)} onPick={onPickIssue} />}
        </div>
      </div>
      <SessionPanel
        sessionId={session.id}
        activeWorkspaceId={active.workspaceId}
        turnIds={turnIds}
        hasPr={prUrls.length > 0}
        running={run.running}
        host={session.host}
      />
      {quickOpen}
    </div>
  );
}

/**
 * Keep the header's agent and the panes in step. Selecting an agent from outside
 * (opening the session, a notification for a companion) shows its tab; focusing an
 * agent's tab (or one of its subagents' tabs) — clicking it, or its pane — makes it
 * the one the header acts on, and the one whose turns count as watched. Focusing
 * Files or Terminal changes neither.
 */
function useFollowAgent(
  panes: Panes,
  roster: { workspaceId: string }[],
  selected: string | null,
  select: (workspaceId: string) => void
): void {
  const seen = useRef<string | null>(null);
  const focusedTab = focusedGroup(panes.layout).active;
  const show = panes.select;
  // An agent picked before its tab exists (a companion just added) waits for it.
  const rosterKey = roster.map((r) => r.workspaceId).join(" ");
  useEffect(() => {
    const has = (id: string) => rosterKey.split(" ").includes(id);
    if (selected !== seen.current) {
      if (selected && !has(selected)) return;
      seen.current = selected;
      if (selected) show(agentTab(selected));
      return;
    }
    const agent = agentOfTab(focusedTab) ?? resolvePanel(focusedTab)?.owner ?? null;
    if (agent && agent !== selected && has(agent)) {
      seen.current = agent;
      select(agent);
    }
  }, [selected, focusedTab, rosterKey, show, select]);
}
