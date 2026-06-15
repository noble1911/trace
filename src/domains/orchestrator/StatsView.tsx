import { useMemo } from "react";
import { useActivityStore } from "@/domains/activity/store";
import { columnColor } from "@/domains/board/columns";
import { useBoardStore } from "@/domains/board/store";
import { useJiraStore } from "@/domains/jira/store";
import { type BoardStats, computeBoardStats, filterByAssignee } from "./stats";
import { useOrchestratorStore } from "./store";

// The deterministic board overview — no AI. Reads the board store and renders
// the metrics from stats.ts, scoped to the board's current assignee filter.
export function StatsView() {
  const board = useBoardStore((s) => s.data);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const ackedWaiting = useBoardStore((s) => s.ackedWaiting);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const assigneeFilter = useBoardStore((s) => s.assigneeFilter);
  const activity = useActivityStore((s) => s.events);
  const currentUser = useJiraStore((s) => s.user);
  const sprintGoal = useOrchestratorStore((s) => s.sprintGoal);
  const setSprintGoal = useOrchestratorStore((s) => s.setSprintGoal);

  // Mirror the board: until the user picks, the filter defaults to themselves.
  const effectiveAssignee =
    assigneeFilter === undefined ? (currentUser?.accountId ?? null) : assigneeFilter;

  const stats = useMemo<BoardStats>(
    () =>
      computeBoardStats(
        filterByAssignee(
          {
            board,
            runningAgents,
            agentActivity,
            ackedWaiting,
            pullRequests,
            activity,
            now: Date.now(),
          },
          effectiveAssignee
        )
      ),
    [board, runningAgents, agentActivity, ackedWaiting, pullRequests, activity, effectiveAssignee]
  );

  if (!board) {
    return <div className="orch-empty">Load a board to see stats.</div>;
  }

  const scopeName =
    effectiveAssignee === null
      ? "Everyone"
      : effectiveAssignee === currentUser?.accountId
        ? currentUser.displayName
        : (board.issues.find((i) => i.assignee?.accountId === effectiveAssignee)?.assignee
            ?.displayName ?? "Selected assignee");

  return (
    <div className="orch-stats">
      <div className="orch-goal">
        <label htmlFor="orch-goal-input" className="orch-goal-label">
          Sprint goal
        </label>
        <input
          id="orch-goal-input"
          className="orch-goal-input"
          value={sprintGoal}
          placeholder="What does a good sprint look like?"
          onChange={(e) => setSprintGoal(e.target.value)}
        />
      </div>

      <div className="orch-scope">
        Showing <span className="who">{scopeName}</span>
      </div>

      {stats.flags.length > 0 && (
        <div className="orch-flags">
          {stats.flags.map((f) => (
            <div key={f} className="orch-flag">
              {f}
            </div>
          ))}
        </div>
      )}

      <div className="stat-row">
        <Stat label="Tickets" value={stats.total} />
        <Stat label="Done" value={`${stats.done} · ${stats.pctDone}%`} />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="To do" value={stats.todo} />
      </div>

      <Section title="Columns">
        <div className="orch-cols">
          {stats.columns.map((c, i) => (
            <div key={c.name} className="orch-col-row">
              <span className="dot" style={{ background: columnColor(i, stats.columns.length) }} />
              <span className="name">{c.name}</span>
              <span className="count">{c.count}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Agents">
        <div className="stat-row">
          <Stat label="Running" value={stats.agents.running} />
          <Stat label="Working" value={stats.agents.working} accent="prog" />
          <Stat label="Waiting" value={stats.agents.waiting} accent="prog" />
        </div>
      </Section>

      <Section title="Pull requests">
        <div className="stat-row">
          <Stat label="Open" value={stats.prs.open} accent="review" />
          <Stat label="Draft" value={stats.prs.draft} />
          <Stat label="Merged" value={stats.prs.merged} accent="done" />
          <Stat label="Closed" value={stats.prs.closed} />
        </div>
      </Section>

      <Section title="Last 7 days">
        <div className="stat-row">
          <Stat label="Agents started" value={stats.throughput7d.started} />
          <Stat label="PRs raised" value={stats.throughput7d.raised} />
          <Stat label="PRs merged" value={stats.throughput7d.merged} accent="done" />
        </div>
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "prog" | "review" | "done";
}) {
  return (
    <div className="stat-cell">
      <div className={`v${accent ? ` ${accent}` : ""}`}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="orch-section">
      <div className="orch-section-title">{title}</div>
      {children}
    </div>
  );
}
