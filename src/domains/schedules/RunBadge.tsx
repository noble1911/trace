import { useBoardStore } from "@/domains/board/store";
import { STATUS_LABEL } from "./describe";
import { runWorkspaceId } from "./ids";
import type { ScheduleRun } from "./types";

/**
 * Whether a live run is stuck on the user right now. The backend flags a run
 * once Claude asks for a human, but only the renderer's quiet-timer knows the
 * agent is *still* waiting (vs. carrying on after the user answered).
 */
export function useRunNeedsYou(run: ScheduleRun | undefined): boolean {
  const waiting = useBoardStore((s) =>
    run ? s.agentActivity[runWorkspaceId(run.id)] === "waiting" : false
  );
  return !!run && run.status === "running" && run.needsInput && waiting;
}

// Status dot + label for one run.
export function RunBadge({ run }: { run: ScheduleRun }) {
  const needsYou = useRunNeedsYou(run);
  if (needsYou) return <span className="waiting">needs input</span>;
  if (run.status === "running") return <span className="thinking">running</span>;
  return (
    <span className={`run-badge ${run.status}`}>
      <span className="run-dot" />
      {STATUS_LABEL[run.status]}
    </span>
  );
}
