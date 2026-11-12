import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ActivityView } from "@/domains/activity/ActivityView";
import { Board } from "@/domains/board/Board";
import { BoardsPage } from "@/domains/boards/BoardsPage";
import { FleetView } from "@/domains/fleet/FleetView";
import { InboxView } from "@/domains/inbox/InboxView";
import { IntegrationsView } from "@/domains/integrations/IntegrationsView";
import type { ProviderKind } from "@/domains/issues/types";
import { PrsView } from "@/domains/prs/PrsView";
import { SchedulesView } from "@/domains/schedules/SchedulesView";
import { SessionsView } from "@/domains/sessions/SessionsView";
import { SettingsView } from "@/domains/settings/SettingsView";
import { NAV_LABELS, type NavId } from "./nav";
import { openWorkspace } from "./openWorkspace";
import { PagePanel } from "./PagePanel";
import { TrackerMissing } from "./TrackerMissing";

interface PageContentProps {
  nav: NavId;
  /** A pinned page whose tracker isn't connected: it says how to connect one instead. */
  missingTracker: ProviderKind | null;
  /** A board page (a tracker's or Boards) that has its tracker. */
  isBoardPage: boolean;
  setNav: (nav: NavId) => void;
  /** Navigating from inside a page: leaves any open detail first. */
  onNav: (nav: NavId) => void;
}

// The page the rail has selected, inside the main area, with the orchestrator's panel
// on the pages where it helps (⌘J).
export function PageContent({ nav, missingTracker, isBoardPage, setNav, onNav }: PageContentProps) {
  return (
    <main className="main">
      <ErrorBoundary key={nav} inPage label={`The ${NAV_LABELS[nav]} page crashed`}>
        {nav === "inbox" && <InboxView onOpen={(id) => openWorkspace(id, setNav)} />}
        {isBoardPage && (nav === "boards" ? <BoardsPage /> : <Board />)}
        {nav === "fleet" && <FleetView onOpen={(id) => openWorkspace(id, setNav)} />}
        {nav === "sessions" && <SessionsView />}
        {nav === "scheduled" && <SchedulesView />}
        {nav === "pr" && !missingTracker && <PrsView />}
        {missingTracker && <TrackerMissing nav={nav} tracker={missingTracker} onNav={onNav} />}
        {nav === "activity" && <ActivityView />}
        {nav === "integrations" && <IntegrationsView />}
        {nav === "settings" && <SettingsView />}
        {isBoardPage && <PagePanel key={nav} place="board" />}
        {nav === "sessions" && <PagePanel key={nav} place="sessions" />}
      </ErrorBoundary>
    </main>
  );
}
