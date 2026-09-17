import { useBoardStore } from "@/domains/board/store";
import { runWorkspaceId } from "../ids";
import { useSchedulesStore } from "../store";

/**
 * Whether any live scheduled run is stuck waiting on the user — drives the
 * rail's badge. Same rule as `useRunNeedsYou`: flagged by the backend hook AND
 * still quiet now.
 */
export function useScheduledNeedsYou(): boolean {
  // Select stable references and derive here: a selector that builds a fresh
  // array on every call never settles under useSyncExternalStore.
  const runs = useSchedulesStore((s) => s.runs);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  return runs.some(
    (r) =>
      r.status === "running" && r.needsInput && agentActivity[runWorkspaceId(r.id)] === "waiting"
  );
}
