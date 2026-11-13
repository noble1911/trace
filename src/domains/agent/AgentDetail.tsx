import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { SidePanel } from "@/components/SidePanel";
import { useSidePanel } from "@/components/useSidePanel";
import { activity } from "@/domains/activity/store";
import { useAgentMenuItems } from "@/domains/agentChat/agentMenu";
import { ChatAgentPane } from "@/domains/agentChat/ChatAgentPane";
import { stopAndWait } from "@/domains/agentChat/switch";
import { defaultTransport, hasChat, useAgentTransport } from "@/domains/agentChat/transport";
import { adoptIfAlive } from "@/domains/board/adopt";
import { statusOf, useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { shownAsk } from "@/domains/live/light";
import { useAgentQuiet } from "@/domains/live/quietStore";
import { useLiveStore } from "@/domains/live/store";
import { OrchestratorPane } from "@/domains/orchestrator/OrchestratorPane";
import { PaneArea } from "@/domains/panes/PaneArea";
import { layoutItems } from "@/domains/panes/paneMenu";
import { isTabOn, useOnTabs, useTabSettings } from "@/domains/panes/tabSettings";
import { usePanes } from "@/domains/panes/usePanes";
import { usePlanTab } from "@/domains/plans/store";
import { discoverPrs, usePrWatch } from "@/domains/prs/hooks/usePrWatch";
import { primaryPr } from "@/domains/prs/primaryPr";
import { canonicalPrUrl } from "@/domains/prs/prUrl";
import { usePrWatchStore } from "@/domains/prs/watchStore";
import { useQuickOpen } from "@/domains/quickOpen/useQuickOpen";
import {
  type AgentCli,
  type AgentProvider,
  resetAgentSession,
  stopAgent,
  type Transport,
} from "@/ipc/agent";
import { mergePr, raisePr } from "@/ipc/pr";
import { setIssueRepo } from "@/ipc/repos";
import { ChatSurface } from "./ChatSurface";
import { ContextRail } from "./ContextRail";
import { useCapabilities } from "./capabilities";
import { DetailHeader } from "./DetailHeader";
import { agentCli, agentProvider, setAgentCli, setAgentProvider } from "./defaults";
import { useHasExited } from "./exitedStore";
import { launchIssueAgent } from "./launch";
import { agentLabel } from "./providerLabel";
import { usePrTab, useTestsTab } from "./reviewTabs";
import { StartPrompt } from "./StartPrompt";
import { TICKET_CHAT_TAB, ticketPanels } from "./ticketPanels";
import { useDetailKeys } from "./useDetailKeys";
import { useIssueRepos } from "./useIssueRepos";
import { usePickableRepos } from "./usePickableRepos";
import { useRunsOn } from "./useRunsOn";
import { useViewerTabs } from "./viewerTabs";
import { useWorkspaceTabs } from "./workspaceTabs";

interface AgentDetailProps {
  issue: Issue;
  site: string | null;
  onBack: () => void;
  /** The page Back returns to ("Inbox", "Board", …). */
  backLabel: string;
}

// Stable reference so the board-store selector below doesn't return a brand-new
// empty array on every render (which would churn re-renders).
const EMPTY_PRS: PullRequest[] = [];

export function AgentDetail({ issue, site, onBack, backLabel }: AgentDetailProps) {
  const [busy, setBusy] = useState<"raise" | "merge" | null>(null);
  const [cli, setCli] = useState<AgentCli>(agentCli);
  // What the agent runs on (once it has run), and what the Start menu picks for the next start.
  const ranOn = useAgentTransport(issue.key);
  const [nextTransport, setNextTransport] = useState<Transport | undefined>();
  const isChat = ranOn === "chat";
  const [provider, setProvider] = useState<AgentProvider>(agentProvider);
  const { state: runsOn, picked: pickedHost, refresh: refreshHost } = useRunsOn(issue.key);
  const caps = useCapabilities(issue.key);
  // Right edge: the ticket's details, or the orchestrator — one at a time.
  const panel = useSidePanel("ticket", ["context", "orchestrator"]);
  // The repos Start offers (the board's, when it has some) and the pick.
  const { repos, repoChoice, setRepoChoice } = useIssueRepos(issue.key);
  const pickable = usePickableRepos(runsOn.host, repos, repoChoice, setRepoChoice);
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  const exited = useHasExited(issue.key);
  // Selecting a primitive (length) keeps this referentially stable across renders.
  const plan = usePlanTab(issue.key);
  const viewers = useViewerTabs(issue.key);
  const filesOn = useTabSettings((s) => isTabOn(s.off, "files"));
  const workspace = useWorkspaceTabs(issue.key, filesOn);
  const status = useBoardStore((s) =>
    statusOf(s.runningAgents.has(issue.key), s.agentActivity[issue.key])
  );
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const live = useLiveStore((s) => s.info[issue.key]);
  const quiet = useAgentQuiet(issue.key);
  const startingRef = useRef(false);
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);
  const refreshIssuePrs = useBoardStore((s) => s.refreshIssuePrs);

  // Jira's dev-status PRs, plus whatever the agent raised that Jira hasn't
  // linked (or can't — no dev integration): the branch's PRs and conversation.
  const devUrls = useMemo(
    () => prs.map((pr) => canonicalPrUrl(pr.url)).filter((u): u is string => u !== null),
    [prs]
  );
  const prUrls = usePrWatch(issue.key, [issue.key], devUrls);
  const threads = usePrWatchStore((s) => s.threads);
  const openPr = primaryPr(prUrls, threads, prs);

  // Viewing a waiting session acknowledges it: the rail/Dock badges clear
  // without requiring a reply. Re-runs when the status flips while open.
  useEffect(() => {
    if (status === "waiting") ackWaiting(issue.key);
  }, [status, issue.key, ackWaiting]);

  // Reconcile run-state with the backend on mount. Startup adoption has usually done
  // this, but this view can mount first — and without it a live agent shows the Start
  // overlay, where clicking Start no-ops on the backend (already running) after the
  // terminal was cleared, leaving a blank screen.
  // Adopt the backend's truth so the live screen (terminal snapshot) shows.
  useEffect(() => {
    void adoptIfAlive(issue.key);
  }, [issue.key]);

  // Re-check this issue's PRs on open — they change outside the app.
  useEffect(() => {
    void refreshIssuePrs(issue.key, issue.id);
  }, [issue.key, issue.id, refreshIssuePrs]);

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    setAgentCli(next);
  };
  const chooseProvider = (next: AgentProvider) => {
    setProvider(next);
    setAgentProvider(next);
  };

  const start = async (transport: Transport | undefined = nextTransport) => {
    // Guard against a re-entrant start: worktree creation takes a few seconds,
    // during which the button still reads "Start". A second click would spawn a
    // *second* agent into the same workspace — two processes painting one
    // terminal, which duplicates the banner.
    if (startingRef.current || useBoardStore.getState().runningAgents.has(issue.key)) return;
    if (!repoChoice) {
      toast.error("Add a repository in Settings, then pick one for this ticket.");
      return;
    }
    startingRef.current = true;
    try {
      // Remember which repo this ticket runs in — the backend resolves it for
      // every subsequent terminal/files/tests/PR command on this issue.
      await setIssueRepo(issue.key, repoChoice);
      // The terminal is already mounted (behind the StartPrompt overlay) and
      // fitted, so launch spawns the PTY at its exact size — no spawn-time
      // SIGWINCH double-painting the banner. No kickoff brief here: starting
      // from inside the ticket opens a plain session (the user is present to
      // direct it) — only the board paths (card button, drag) send the brief.
      // A sandbox with no saved Claude login can only be a terminal, to sign in from.
      const shownAs = runsOn.chatBlock ? "terminal" : transport;
      await launchIssueAgent(issue.key, { cli, provider, transport: shownAs, host: pickedHost });
      refreshHost();
    } catch (err) {
      toast.error(`Couldn't start the agent: ${String(err)}`);
    } finally {
      startingRef.current = false;
    }
  };
  const stop = async () => {
    // A chat agent takes a moment to exit; Start must not race it.
    await stopAndWait(issue.key).catch(() => stopAgent(issue.key).catch(() => {}));
    setAgentRunning(issue.key, false);
    clearOutput(issue.key);
    // Keep the terminal alive and attached — it stays measurable so the next
    // start() can spawn at the real pane size, and it's torn down by
    // PtyTerminal's unmount cleanup once nothing is running.
  };
  const restart = async (transport?: Transport) => {
    await stopAndWait(issue.key);
    await start(transport);
  };
  const agentItems = useAgentMenuItems({
    workspaceId: issue.key,
    cli,
    running,
    restart,
    start: (t) => start(t),
  });
  // Forget the saved Claude conversation, then start clean — the escape hatch
  // when a stored session id has gone stale ("session not found" on resume).
  const startFresh = async () => {
    await resetAgentSession(issue.key).catch(() => {});
    await start();
  };

  const onRaisePr = async () => {
    setBusy("raise");
    try {
      const title = `[${issue.key}] ${issue.summary}`;
      const body = `Closes ${issue.key}${issue.description ? `\n\n${issue.description}` : ""}`;
      const { url } = await raisePr(issue.key, title, body);
      await Promise.all([refreshIssuePrs(issue.key, issue.id), discoverPrs(issue.key)]);
      activity.log({ kind: "pr-raised", issueKey: issue.key, title: "raised a PR" });
      void openUrl(url);
    } catch (err) {
      toast.error(`Couldn't raise the PR: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onMergePr = async () => {
    if (!openPr) return;
    setBusy("merge");
    try {
      await mergePr(issue.key, openPr.url);
      await refreshIssuePrs(issue.key, issue.id);
      activity.log({ kind: "pr-merged", issueKey: issue.key, title: `merged #${openPr.number}` });
    } catch (err) {
      toast.error(`Couldn't merge #${openPr.number}: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // The agent's own tab: its chat, or its terminal — mounted even before the session
  // starts so it can be measured and fitted to the real pane; StartPrompt covers it.
  const chat = isChat ? (
    <ChatAgentPane workspaceId={issue.key} onStart={() => void start()} />
  ) : (
    <ChatSurface workspaceId={issue.key} cli={cli}>
      {!running && (
        <StartPrompt
          onStart={() => void start()}
          onStartFresh={startFresh}
          repos={pickable.repos}
          sandboxNote={pickable.note}
          repoChoice={repoChoice}
          onRepoChange={setRepoChoice}
          agentName={agentLabel(cli, provider)}
          cliName={cli}
          exited={exited}
          asChat={hasChat(cli) && (nextTransport ?? ranOn ?? defaultTransport(cli)) === "chat"}
        />
      )}
    </ChatSurface>
  );
  const tests = useTestsTab(issue.key);
  const pr = usePrTab(issue.key, prUrls);
  const panels = useOnTabs(
    ticketPanels({
      issue,
      site,
      cli,
      chat,
      plan,
      viewers,
      workspace,
      tests,
      pr,
      prUrls,
      remote: runsOn.remote,
      filesInSandbox: caps?.files === true,
      peer: runsOn.onPeer
        ? { terminal: caps?.terminal === true, tests: caps?.tests === true }
        : undefined,
    })
  );
  const panes = usePanes(`ticket:${issue.key}`, panels, { [issue.key]: TICKET_CHAT_TAB });
  useDetailKeys(
    onBack,
    panels.filter((p) => !p.hidden).map((p) => p.id),
    panes.select
  );
  const quickOpen = useQuickOpen(issue.key, true, () => panes.reveal("files"));

  return (
    <div className="detail">
      <DetailHeader
        issue={issue}
        site={site}
        light={live?.light ?? "stopped"}
        askLabel={shownAsk(live)?.label}
        quiet={quiet}
        running={running}
        exited={exited}
        cli={cli}
        provider={provider}
        openPr={openPr}
        busy={busy}
        onBack={onBack}
        backLabel={backLabel}
        onRaisePr={onRaisePr}
        onMergePr={onMergePr}
        onStart={() => void start()}
        onStop={stop}
        onChooseCli={chooseCli}
        onChooseProvider={chooseProvider}
        transport={nextTransport ?? ranOn}
        onChooseTransport={setNextTransport}
        runsOn={runsOn}
        agentItems={agentItems}
        layoutItems={layoutItems(panes)}
      />

      <div className="detail-body">
        <div className="detail-left">
          <PaneArea panes={panes} />
        </div>
      </div>
      {/* Next step, workspace, ticket — docked on the right edge, folding to a strip. */}
      <SidePanel
        views={[
          {
            id: "context",
            label: "Details",
            content: (
              <ContextRail issue={issue} site={site} hasPr={prUrls.length > 0} running={running} />
            ),
          },
          { id: "orchestrator", label: "Orchestrator", content: <OrchestratorPane /> },
        ]}
        active={panel.view}
        open={panel.open}
        onShow={panel.show}
        onClose={panel.close}
      />
      {quickOpen}
    </div>
  );
}
