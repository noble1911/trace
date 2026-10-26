import { useEffect, useState } from "react";
import { InterruptedAgents } from "@/app/InterruptedAgents";
import { NAV_LABELS, type NavId } from "@/app/nav";
import { openWorkspace } from "@/app/openWorkspace";
import { Rail } from "@/app/Rail";
import { Topbar } from "@/app/Topbar";
import { useAppEvents } from "@/app/useAppEvents";
import { useGlobalKeys } from "@/app/useGlobalKeys";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { I } from "@/components/Icon";
import { Toaster } from "@/components/Toaster";
import { ActivityView } from "@/domains/activity/ActivityView";
import { useActivityFeed } from "@/domains/activity/hooks/useActivityFeed";
import { AgentDetail } from "@/domains/agent/AgentDetail";
import { Board } from "@/domains/board/Board";
import { useBoardAutoRefresh } from "@/domains/board/hooks/useBoardAutoRefresh";
import { useBoardStore } from "@/domains/board/store";
import { FleetView } from "@/domains/fleet/FleetView";
import { InboxView } from "@/domains/inbox/InboxView";
import { ProviderLogin } from "@/domains/issues/components/ProviderLogin";
import { useIssuesStore } from "@/domains/issues/store";
import { useLiveStore } from "@/domains/live/store";
import { OrchestratorFab } from "@/domains/orchestrator/Fab";
import { OrchestratorPanel } from "@/domains/orchestrator/Panel";
import { PrsView } from "@/domains/prs/PrsView";
import { useScheduleEvents } from "@/domains/schedules/hooks/useScheduleEvents";
import { SchedulesView } from "@/domains/schedules/SchedulesView";
import { useSchedulesStore } from "@/domains/schedules/store";
import { RecentSessions } from "@/domains/sessions/RecentSessions";
import { useRecentsCollapsed } from "@/domains/sessions/recentsLayout";
import { SessionDetail } from "@/domains/sessions/SessionDetail";
import { SessionsView } from "@/domains/sessions/SessionsView";
import { useSessionsStore } from "@/domains/sessions/store";
import { SettingsView } from "@/domains/settings/SettingsView";
import { consumeNotificationClick, setDockBadge } from "@/ipc/notify";
import { checkAppUpdate } from "@/ipc/update";
import { toast } from "./app/toast";

// Once per app run (module-level so StrictMode's double-mount can't re-check).
let updateCheckDone = false;

// Shell only — boot, the issue-tracker login gate, nav routing, and the detail overlay.
// All feature logic lives in src/domains/*.
export function App() {
  const [nav, setNav] = useState<NavId>("board");

  const initialized = useIssuesStore((s) => s.initialized);
  const trackerSessions = useIssuesStore((s) => s.sessions);
  const boards = useIssuesStore((s) => s.boards);
  const selectedBoardKey = useIssuesStore((s) => s.selectedBoardKey);
  const selectBoard = useIssuesStore((s) => s.selectBoard);
  const init = useIssuesStore((s) => s.init);
  const hasSession = Object.keys(trackerSessions).length > 0;

  const data = useBoardStore((s) => s.data);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const refresh = useBoardStore((s) => s.refresh);
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
  useActivityFeed();

  useAppEvents();

  // Load the board whenever the selected board changes.
  useEffect(() => {
    if (hasSession && selectedBoardKey != null) void loadBoard(selectedBoardKey);
  }, [hasSession, selectedBoardKey, loadBoard]);

  // Quiet update check shortly after launch — publishing a GitHub release IS
  // the rollout, so surface it without requiring a trip to Settings. Errors
  // are silent (dev builds have no release feed behind them).
  useEffect(() => {
    if (updateCheckDone) return;
    updateCheckDone = true;
    const t = setTimeout(() => {
      checkAppUpdate()
        .then((update) => {
          if (update) toast.info(`trace v${update.version} is available — Settings → Updates`);
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  useBoardAutoRefresh();
  const [recentsCollapsed] = useRecentsCollapsed();

  const refreshAllPrs = useBoardStore((s) => s.refreshAllPrs);
  useEffect(() => {
    let lastPrRefresh = 0;
    const onFocus = () => {
      // A focus right after a waiting notification ≈ the user clicked it:
      // jump straight to that workspace's detail (issue card or session).
      const target = consumeNotificationClick();
      if (target) openWorkspace(target, setNav);
      // PR statuses change outside the app (agents run gh; merges happen in
      // the browser) — re-check on focus, at most once a minute.
      if (Date.now() - lastPrRefresh >= 60_000) {
        lastPrRefresh = Date.now();
        refreshAllPrs();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAllPrs]);

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

  if (!hasSession) return <ProviderLogin />;

  const openIssue = selectedIssueKey
    ? (data?.issues.find((i) => i.key === selectedIssueKey) ?? null)
    : null;
  const openSession = selectedSessionId
    ? (sessions.find((s) => s.id === selectedSessionId) ?? null)
    : null;
  // A detail overlays the current page; Back returns to it, so it says which.
  const backLabel = NAV_LABELS[nav].replace(/^./, (c) => c.toUpperCase());
  const project = data?.boardName ?? trackerSessions.jira?.site ?? "trace";

  // The rail stays visible inside a detail view; clicking a nav item there should
  // leave the detail and go to that view, not just swap the hidden content under it.
  const handleNav = (id: NavId) => {
    closeIssue();
    closeSession();
    useSchedulesStore.getState().close();
    setNav(id);
  };

  const boardActions = (
    <>
      {boards.length > 1 && (
        <select
          value={selectedBoardKey ?? ""}
          onChange={(e) => selectBoard(e.target.value)}
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--fg-1)",
            height: 30,
            padding: "0 8px",
            fontSize: 12.5,
          }}
        >
          {boards.map((b) => (
            <option key={b.key} value={b.key}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn ghost"
        title="Refresh board"
        onClick={() => void refresh()}
      >
        <I.Activity size={14} />
      </button>
    </>
  );

  // The Recents sidebar sits beside an open session detail, for hopping between
  // sessions without backing out. Not on the Sessions list — it would just
  // repeat the list next to itself.
  const showRecents = openSession != null;

  // `has-recents` lives on the root wrapper (not `.app`) so it can inset both
  // the app grid AND the fixed orchestrator FAB/panel — siblings of `.app` —
  // away from the right-docked recents column.
  return (
    <div
      className={`app-root${showRecents ? " has-recents" : ""}${recentsCollapsed ? " recents-collapsed" : ""}`}
    >
      <div className="app">
        <Rail nav={nav} onNav={handleNav} waitingCount={waitingCount} />
        {showRecents && <RecentSessions />}
        <Topbar
          nav={nav}
          project={project}
          extra={nav === "board" ? boardActions : undefined}
          onNav={handleNav}
        />
        <main className="main">
          {nav === "inbox" && <InboxView onOpen={(id) => openWorkspace(id, setNav)} />}
          {nav === "board" && <Board />}
          {nav === "fleet" && <FleetView onOpen={(id) => openWorkspace(id, setNav)} />}
          {nav === "sessions" && <SessionsView />}
          {nav === "scheduled" && <SchedulesView />}
          {nav === "pr" && <PrsView />}
          {nav === "activity" && <ActivityView />}
          {nav === "settings" && <SettingsView />}
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
      <OrchestratorFab />
      <OrchestratorPanel />
      <InterruptedAgents />
      <Toaster />
    </div>
  );
}
