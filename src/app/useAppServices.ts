import { useEffect } from "react";
import { useActivityFeed } from "@/domains/activity/hooks/useActivityFeed";
import { useBoardAutoRefresh } from "@/domains/board/hooks/useBoardAutoRefresh";
import { useIssuesStore } from "@/domains/issues/store";
import { useLiveStore } from "@/domains/live/store";
import { useWorktreeSetupToasts } from "@/domains/repos/useWorktreeSetupToasts";
import { useScheduleEvents } from "@/domains/schedules/hooks/useScheduleEvents";
import { setDockBadge } from "@/ipc/notify";
import type { NavId } from "./nav";
import { useAppNavForOpeners } from "./openWorkspace";
import { useAppEvents } from "./useAppEvents";
import { useBoardSelection } from "./useBoardSelection";
import { useFocusRefresh } from "./useFocusRefresh";
import { useGlobalKeys } from "./useGlobalKeys";
import { useUpdateCheck } from "./useUpdateCheck";

/**
 * What runs app-wide for as long as the window is open: restoring the trackers, the
 * backend's events, the board that follows the page, focus refreshes, the global keys.
 * Answers how many agents need you (the inbox's count, on the rail and the Dock).
 */
export function useAppServices(nav: NavId, setNav: (nav: NavId) => void): number {
  const init = useIssuesStore((s) => s.init);
  const liveInfo = useLiveStore((s) => s.info);

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
  return waitingCount;
}
