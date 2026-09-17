import { agentLabel } from "@/domains/agent/providerLabel";
import { formatDuration, formatWhen } from "./describe";
import { RunBadge } from "./RunBadge";
import type { ScheduledPrompt, ScheduleRun } from "./types";

interface RunListProps {
  prompt: ScheduledPrompt;
  /** This prompt's runs, newest first. */
  runs: ScheduleRun[];
  activeId: string | null;
  onSelect: (runId: string) => void;
}

// Left column of the schedule detail: what the prompt says and how it runs, then
// its run history (newest first; the backend keeps the last 30).
export function RunList({ prompt, runs, activeId, onSelect }: RunListProps) {
  const settings = [
    agentLabel("claude", prompt.provider),
    prompt.model,
    prompt.extraArgs.join(" "),
    prompt.timeoutMins > 0 ? `${prompt.timeoutMins}m timeout` : "no timeout",
  ].filter(Boolean);

  return (
    <aside className="sched-runs">
      <div className="sched-prompt">
        <div className="sched-section-head">Prompt</div>
        <div className="sched-prompt-text">{prompt.prompt}</div>
        <div className="sched-prompt-meta">{settings.join(" · ")}</div>
      </div>
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
