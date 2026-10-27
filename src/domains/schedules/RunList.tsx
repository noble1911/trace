import { formatDuration, formatWhen } from "./describe";
import { RunBadge } from "./RunBadge";
import type { ScheduleRun } from "./types";

interface RunListProps {
  /** This prompt's runs, newest first. */
  runs: ScheduleRun[];
  activeId: string | null;
  onSelect: (runId: string) => void;
}

// Left column of the schedule detail: the prompt's run history (newest first;
// the backend keeps the last 30). The prompt itself is the viewer's Prompt tab.
export function RunList({ runs, activeId, onSelect }: RunListProps) {
  return (
    <aside className="sched-runs">
      <div className="sched-section-head">
        Runs <span className="count">{runs.length}</span>
      </div>
      <div className="sched-run-list">
        {runs.map((run) => {
          const meta = [
            run.endedAt ? formatDuration(run.endedAt - run.startedAt) : null,
            run.trigger === "manual" ? "manual" : null,
            run.skipped > 0 ? `${run.skipped} skipped` : null,
          ].filter(Boolean);
          return (
            <button
              key={run.id}
              type="button"
              className={`sched-run${run.id === activeId ? " active" : ""}`}
              onClick={() => onSelect(run.id)}
            >
              <span className="sched-run-top">
                <RunBadge run={run} />
                <span className="when">{formatWhen(run.startedAt)}</span>
              </span>
              {meta.length > 0 && <span className="sched-run-meta">{meta.join(" · ")}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
