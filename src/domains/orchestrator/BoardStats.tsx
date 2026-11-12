import { useMemo } from "react";
import { useActivityStore } from "@/domains/activity/store";
import { effectiveAssignee } from "@/domains/board/assignee";
import { columnColor } from "@/domains/board/columns";
import { useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import type { BoardData } from "@/domains/issues/types";
import { lightsOf, useLiveStore } from "@/domains/live/store";
import { Flags, Section, Stat } from "./StatBits";
import { computeBoardStats, filterByAssignee, type BoardStats as Stats } from "./stats";
import { useOrchestratorStore } from "./store";

// The deterministic board overview — no AI. Reads the board store and renders
// the metrics from stats.ts, scoped to the board's current assignee filter.
export function BoardStats({ board }: { board: BoardData }) {
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const live = useLiveStore((s) => s.info);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const assigneeFilter = useBoardStore((s) => s.assigneeFilter);
  const activity = useActivityStore((s) => s.events);
  const boardProvider = useBoardStore((s) => s.provider);
  const currentUser = useIssuesStore((s) =>
    boardProvider ? (s.users[boardProvider] ?? null) : null
  );
  const sprintGoal = useOrchestratorStore((s) => s.sprintGoal);
  const setSprintGoal = useOrchestratorStore((s) => s.setSprintGoal);

  // Mirror the board: until the user picks, the filter defaults to themselves.
  const assignee = effectiveAssignee(boardProvider, assigneeFilter, currentUser?.accountId ?? null);

  const stats = useMemo<Stats>(
    () =>
      computeBoardStats(
        filterByAssignee(
          {
            board,
            runningAgents,
            lights: lightsOf(live),
            pullRequests,
            activity,
            now: Date.now(),
          },
          assignee
        )
      ),
    [board, runningAgents, live, pullRequests, activity, assignee]
  );

  const scopeName =
    assignee === null
      ? "Everyone"
      : assignee === currentUser?.accountId
        ? currentUser.displayName
        : (board.issues.find((i) => i.assignee?.accountId === assignee)?.assignee?.displayName ??
          "Selected assignee");

  return (
    <>
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

      <Flags flags={stats.flags} />

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
          <Stat label="Working" value={stats.agents.working} accent="working" />
          <Stat label="Needs you" value={stats.agents.needsYou} accent="needs" />
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
    </>
  );
}
