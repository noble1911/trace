import { useEffect, useState } from "react";
import { BoardActions } from "@/app/BoardActions";
import { InterruptedAgents } from "@/app/InterruptedAgents";
import { NAV_LABELS, type NavId, navTracker, resolveNav } from "@/app/nav";
import { openWorkspace, useAppNavForOpeners } from "@/app/openWorkspace";
import { PagePanel } from "@/app/PagePanel";
import { Rail } from "@/app/Rail";
import { Topbar } from "@/app/Topbar";
import { TrackerMissing } from "@/app/TrackerMissing";
import { useAppEvents } from "@/app/useAppEvents";
import { useBoardSelection } from "@/app/useBoardSelection";
import { useFocusRefresh } from "@/app/useFocusRefresh";
import { useGlobalKeys } from "@/app/useGlobalKeys";
import { useUpdateCheck } from "@/app/useUpdateCheck";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/Toaster";
import { ActivityView } from "@/domains/activity/ActivityView";
import { useActivityFeed } from "@/domains/activity/hooks/useActivityFeed";
import { AgentDetail } from "@/domains/agent/AgentDetail";
import { RepoConfirm } from "@/domains/agentTools/RepoConfirm";
import { Board } from "@/domains/board/Board";
import { useBoardAutoRefresh } from "@/domains/board/hooks/useBoardAutoRefresh";
import { useBoardStore } from "@/domains/board/store";
import { BoardsPage } from "@/domains/boards/BoardsPage";
import { CustomBoardDialogs } from "@/domains/boards/CustomBoardDialogs";
import { CheatSheet } from "@/domains/cheatSheet/CheatSheet";
import { FleetView } from "@/domains/fleet/FleetView";
import { InboxView } from "@/domains/inbox/InboxView";
import { IntegrationsView } from "@/domains/integrations/IntegrationsView";
import { useIssuesStore } from "@/domains/issues/store";
import { useLiveStore } from "@/domains/live/store";
import { PrsView } from "@/domains/prs/PrsView";
import { useWorktreeSetupToasts } from "@/domains/repos/useWorktreeSetupToasts";
import { useScheduleEvents } from "@/domains/schedules/hooks/useScheduleEvents";
import { SchedulesView } from "@/domains/schedules/SchedulesView";
import { useSchedulesStore } from "@/domains/schedules/store";
import { SessionDetail } from "@/domains/sessions/SessionDetail";
import { SessionsView } from "@/domains/sessions/SessionsView";
import { useSessionsStore } from "@/domains/sessions/store";
import { SettingsView } from "@/domains/settings/SettingsView";
import { SetupFlow } from "@/domains/setup/SetupFlow";
import { pinnedPages } from "@/domains/sidebar/items";
import { useSidebarStore } from "@/domains/sidebar/store";
import { setDockBadge } from "@/ipc/notify";

// Shell only — boot, nav routing, and the detail overlay. A tracker is optional: each one
// connected in Integrations adds its own pages to the rail (`app/nav.ts`).
// All feature logic lives in src/domains/*.
export function App() {
  const [wantedNav, setNav] = useState<NavId>("board");

  const initialized = useIssuesStore((s) => s.initialized);
  const trackerSessions = useIssuesStore((s) => s.sessions);
  const init = useIssuesStore((s) => s.init);
  const sidebar = useSidebarStore((s) => s.entries);
  // Worked out on every render, so a page can't outlive the tracker it needs — unless
  // it's pinned to the rail (Settings → Sidebar), when it says how to connect one.
  const nav = resolveNav(wantedNav, trackerSessions, pinnedPages(sidebar));
  const tracker = navTracker(nav);
  const missingTracker = tracker && !trackerSessions[tracker] ? tracker : null;
  const isBoardPage = (nav === "board" || nav === "pylon" || nav === "boards") && !missingTracker;

  const data = useBoardStore((s) => s.data);
  const selectedIssueKey = useBoardStore((s) => s.selectedIssueKey);
  const closeIssue = useBoardStore((s) => s.closeIssue);
  const liveInfo = useLiveStore((s) => s.info);
  const sessions = useSessionsStore((s) => s.sessions);
  const selectedSessionId = useSessionsStore((s) => s.selectedId);
  const closeSession = useSessionsStore((s) => s.close);

  useEffect(() => {
    void init();
  }, [init]);

  // Scheduled runs start and finish backend-side; keep their store live app-wide.
  useScheduleEvents();
  useWorktreeSetupToasts();
  useActivityFeed();

  useAppEvents();

  useBoardSelection(nav);
  useUpdateCheck();
  useBoardAutoRefresh();
  useFocusRefresh(setNav);
  useAppNavForOpeners(setNav);

  // Agents that need you — the inbox's count, on the rail and the Dock.
  const waitingCount = Object.values(liveInfo).filter((i) => i.light === "attention").length;
  useEffect(() => {
    setDockBadge(waitingCount);
  }, [waitingCount]);

  // ⌘J orchestrator, ⌘⇧N next agent needing you (⌘K/⌘/ already open search).
  useGlobalKeys(setNav);

  if (!initialized) {
    return (
      <div className="empty-state">
        <div className="inner">
          <div className="title">Starting trace…</div>
        </div>
      </div>
    );
  }

  const openIssue = selectedIssueKey
    ? (data?.issues.find((i) => i.key === selectedIssueKey) ?? null)
    : null;
  const openSession = selectedSessionId
    ? (sessions.find((s) => s.id === selectedSessionId) ?? null)
    : null;
  // A detail overlays the current page; Back returns to it, so it says which.
  const backLabel = NAV_LABELS[nav].replace(/^./, (c) => c.toUpperCase());
  // A pinned tracker page with no tracker names no board in the crumbs, nor does Boards
  // with none made yet.
  const fallback = nav === "boards" ? "" : (trackerSessions.jira?.site ?? "trace");
  const project = missingTracker ? "" : (data?.boardName ?? fallback);

  // The rail stays visible inside a detail view; clicking a nav item there should
  // leave the detail and go to that view, not just swap the hidden content under it.
  const handleNav = (id: NavId) => {
    closeIssue();
    closeSession();
    useSchedulesStore.getState().close();
    setNav(id);
  };

  return (
    <div className="app-root">
      <div className="app">
        <Rail nav={nav} onNav={handleNav} waitingCount={waitingCount} />
        <Topbar
          nav={nav}
          project={project}
          extra={isBoardPage ? <BoardActions /> : undefined}
          onNav={handleNav}
        />
        <main className="main">
          <ErrorBoundary key={nav} inPage label={`The ${NAV_LABELS[nav]} page crashed`}>
            {nav === "inbox" && <InboxView onOpen={(id) => openWorkspace(id, setNav)} />}
            {isBoardPage && (nav === "boards" ? <BoardsPage /> : <Board />)}
            {nav === "fleet" && <FleetView onOpen={(id) => openWorkspace(id, setNav)} />}
            {nav === "sessions" && <SessionsView />}
            {nav === "scheduled" && <SchedulesView />}
            {nav === "pr" && !missingTracker && <PrsView />}
            {missingTracker && (
              <TrackerMissing nav={nav} tracker={missingTracker} onNav={handleNav} />
            )}
            {nav === "activity" && <ActivityView />}
            {nav === "integrations" && <IntegrationsView />}
            {nav === "settings" && <SettingsView />}
            {/* The orchestrator, on the pages where it helps (⌘J). */}
            {isBoardPage && <PagePanel key={nav} place="board" />}
            {nav === "sessions" && <PagePanel key={nav} place="sessions" />}
          </ErrorBoundary>
        </main>
      </div>

      {openIssue && (
        <ErrorBoundary label={`${openIssue.key} detail crashed`} onBack={closeIssue}>
          <AgentDetail
            issue={openIssue}
            site={trackerSessions.jira?.site ?? null}
            onBack={closeIssue}
            backLabel={backLabel}
          />
        </ErrorBoundary>
      )}
      {openSession && (
        <ErrorBoundary label="Session detail crashed" onBack={closeSession}>
          <SessionDetail session={openSession} onBack={closeSession} backLabel={backLabel} />
        </ErrorBoundary>
      )}
      <InterruptedAgents />
      <SetupFlow onNav={handleNav} />
      <RepoConfirm />
      <CustomBoardDialogs />
      <CheatSheet onNav={handleNav} />
      <Toaster />
    </div>
  );
}
