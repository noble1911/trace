import { useState } from "react";
import { BoardActions } from "@/app/BoardActions";
import { DetailOverlays } from "@/app/DetailOverlays";
import { InterruptedAgents } from "@/app/InterruptedAgents";
import { NAV_LABELS, type NavId, navTracker, resolveNav } from "@/app/nav";
import { PageContent } from "@/app/PageContent";
import { Rail } from "@/app/Rail";
import { Topbar } from "@/app/Topbar";
import { useAppServices } from "@/app/useAppServices";
import { Toaster } from "@/components/Toaster";
import { RepoConfirm } from "@/domains/agentTools/RepoConfirm";
import { useBoardStore } from "@/domains/board/store";
import { CustomBoardDialogs } from "@/domains/boards/CustomBoardDialogs";
import { CheatSheet } from "@/domains/cheatSheet/CheatSheet";
import { useIssuesStore } from "@/domains/issues/store";
import { useSchedulesStore } from "@/domains/schedules/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { SetupFlow } from "@/domains/setup/SetupFlow";
import { pinnedPages } from "@/domains/sidebar/items";
import { useSidebarStore } from "@/domains/sidebar/store";

// Shell only — boot, nav routing, and the detail overlay. A tracker is optional: each one
// connected in Integrations adds its own pages to the rail (`app/nav.ts`).
// All feature logic lives in src/domains/*.
export function App() {
  const [wantedNav, setNav] = useState<NavId>("board");

  const initialized = useIssuesStore((s) => s.initialized);
  const trackerSessions = useIssuesStore((s) => s.sessions);
  const sidebar = useSidebarStore((s) => s.entries);
  // Worked out on every render, so a page can't outlive the tracker it needs — unless
  // it's pinned to the rail (Settings → Sidebar), when it says how to connect one.
  const nav = resolveNav(wantedNav, trackerSessions, pinnedPages(sidebar));
  const tracker = navTracker(nav);
  const missingTracker = tracker && !trackerSessions[tracker] ? tracker : null;
  const isBoardPage = (nav === "board" || nav === "pylon" || nav === "boards") && !missingTracker;

  const boardName = useBoardStore((s) => s.data?.boardName);
  const closeIssue = useBoardStore((s) => s.closeIssue);
  const closeSession = useSessionsStore((s) => s.close);

  const waitingCount = useAppServices(nav, setNav);

  if (!initialized) {
    return (
      <div className="empty-state">
        <div className="inner">
          <div className="title">Starting trace…</div>
        </div>
      </div>
    );
  }

  // A detail overlays the current page; Back returns to it, so it says which.
  const backLabel = NAV_LABELS[nav].replace(/^./, (c) => c.toUpperCase());
  // A pinned tracker page with no tracker names no board in the crumbs, nor does Boards
  // with none made yet.
  const fallback = nav === "boards" ? "" : (trackerSessions.jira?.site ?? "trace");
  const project = missingTracker ? "" : (boardName ?? fallback);

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
        <PageContent
          nav={nav}
          missingTracker={missingTracker}
          isBoardPage={isBoardPage}
          setNav={setNav}
          onNav={handleNav}
        />
      </div>

      <DetailOverlays backLabel={backLabel} />
      <InterruptedAgents />
      <SetupFlow onNav={handleNav} />
      <RepoConfirm />
      <CustomBoardDialogs />
      <CheatSheet onNav={handleNav} />
      <Toaster />
    </div>
  );
}
