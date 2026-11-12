import { useEffect } from "react";
import { toast } from "@/app/toast";
import { openIssueAnywhere } from "@/domains/board/openIssueAnywhere";
import { useBoardStore } from "@/domains/board/store";
import { runIdOf, runWorkspaceId } from "@/domains/schedules/ids";
import { useSchedulesStore } from "@/domains/schedules/store";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import type { CreatedBy } from "@/domains/sessions/types";
import type { NavId } from "./nav";
import { pageNav, registerPageNav } from "./pageNav";

/**
 * Open whatever a workspace id belongs to: a scheduled run (on the Scheduled
 * page), a session — selecting the right agent tab for a companion — or an
 * issue's detail. Shared by notification clicks, the inbox, the fleet and
 * "next needing you".
 */
export function openWorkspace(workspaceId: string, setNav: (nav: NavId) => void): void {
  const runId = runIdOf(workspaceId);
  if (runId) {
    useBoardStore.getState().closeIssue();
    useSessionsStore.getState().close();
    setNav("scheduled");
    useSchedulesStore.getState().openRun(runId);
    return;
  }
  const sessions = useSessionsStore.getState();
  const session = sessions.sessions.find((s) =>
    agentRoster(s).some((r) => r.workspaceId === workspaceId)
  );
  if (session) {
    // `select` takes a companion's id too, and focuses that agent's tab.
    sessions.select(workspaceId);
    return;
  }
  void openIssueAnywhere(workspaceId);
}

/** App registers its page setter once, for openers that aren't handed one (`pageNav`). */
export function useAppNavForOpeners(setNav: (nav: NavId) => void): void {
  useEffect(() => {
    registerPageNav(setNav);
    return () => {
      if (pageNav() === setNav) registerPageNav(null);
    };
  }, [setNav]);
}

/**
 * Open what started a session: the session or ticket whose agent did, or the
 * scheduled prompt (on the run, when it's still kept). Says so when it's gone.
 */
export function openCreator(cb: CreatedBy): void {
  const setNav = pageNav() ?? (() => {});
  if (cb.kind === "agent") {
    if (cb.parent === "ticket") {
      void openIssueAnywhere(cb.workspaceId);
      return;
    }
    const parent = useSessionsStore.getState().sessions.find((s) => s.id === cb.workspaceId);
    if (parent && !parent.archivedAt) openWorkspace(parent.id, setNav);
    else toast.info(`“${cb.label}” ${parent ? "is in the recycle bin" : "has been deleted"}.`);
    return;
  }
  if (cb.kind === "schedule") {
    const schedules = useSchedulesStore.getState();
    if (cb.runId && schedules.runs.some((r) => r.id === cb.runId)) {
      openWorkspace(runWorkspaceId(cb.runId), setNav);
    } else if (schedules.prompts.some((p) => p.id === cb.promptId)) {
      useBoardStore.getState().closeIssue();
      useSessionsStore.getState().close();
      setNav("scheduled");
      schedules.open(cb.promptId);
    } else toast.info(`The scheduled prompt “${cb.label}” has been deleted.`);
  }
}
