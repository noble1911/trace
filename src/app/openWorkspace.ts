import { useBoardStore } from "@/domains/board/store";
import { runIdOf } from "@/domains/schedules/ids";
import { useSchedulesStore } from "@/domains/schedules/store";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import type { NavId } from "./nav";
import { toast } from "./toast";

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
  const board = useBoardStore.getState();
  // The detail needs the issue itself; one on another board (or filtered out of
  // this one's query) can't open here — say so rather than select a ghost.
  if (!board.data?.issues.some((i) => i.key === workspaceId)) {
    toast.info(`${workspaceId} isn't on the current board — switch boards to open it`);
    return;
  }
  board.openIssue(workspaceId);
}
