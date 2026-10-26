import type { ActivityEvent } from "@/domains/activity/types";
import { groupIssuesByColumn } from "@/domains/board/columns";
import { dedupePrs } from "@/domains/board/prDedupe";
import type { BoardData, PullRequest } from "@/domains/issues/types";
import type { AgentLight } from "@/domains/live/types";

// Deterministic board metrics. All numbers come from here — the orchestrator
// LLM (later phases) only narrates these, never computes them, because LLMs
// miscount. Pure functions over the board state, so they're trivially testable.

export interface ColumnStat {
  name: string;
  count: number;
}

export interface BoardStats {
  columns: ColumnStat[];
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  pctDone: number;
  unassigned: number;
  /** Live agents by light — the same counts the inbox and fleet show. */
  agents: { running: number; working: number; needsYou: number };
  prs: { open: number; draft: number; merged: number; closed: number };
  /** Counts over the last 7 days, from the activity log. */
  throughput7d: { merged: number; raised: number; started: number };
  /** Human-readable attention flags, most-actionable first. */
  flags: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket a dev-status PR state for counting. */
function prBucket(state: string): "open" | "draft" | "merged" | "closed" {
  const s = state.toLowerCase();
  if (s === "merged") return "merged";
  if (s === "draft") return "draft";
  if (s === "declined" || s === "closed") return "closed";
  return "open";
}

export interface StatsInput {
  board: BoardData | null;
  runningAgents: Set<string>;
  /** Each live agent's light (`domains/live`), so these counts match the inbox. */
  lights: Record<string, AgentLight>;
  pullRequests: Record<string, PullRequest[]>;
  activity: ActivityEvent[];
  now: number;
}

export function computeBoardStats(input: StatsInput): BoardStats {
  const { board, runningAgents, lights, pullRequests, activity, now } = input;
  const issues = board?.issues ?? [];
  const columnDefs = board?.columns ?? [];

  const grouped = groupIssuesByColumn(columnDefs, issues);
  const columns: ColumnStat[] = columnDefs.map((col, i) => ({
    name: col.name,
    count: grouped[i]?.length ?? 0,
  }));

  const total = issues.length;
  const done = issues.filter((i) => i.statusCategory === "done").length;
  const inProgress = issues.filter((i) => i.statusCategory === "indeterminate").length;
  const todo = issues.filter((i) => i.statusCategory === "new").length;
  const pctDone = total > 0 ? Math.round((done / total) * 100) : 0;
  const unassigned = issues.filter((i) => !i.assignee).length;

  // Agents (exclude `term:` shells — only Claude/Codex agents count).
  const liveAgents = [...runningAgents].filter((k) => !k.startsWith("term:"));
  const working = liveAgents.filter((k) => lights[k] === "working").length;
  const needsYou = liveAgents.filter((k) => lights[k] === "attention").length;

  // PRs — dedupe by url with state finality (a stale "open" must not shadow a
  // fresh "merged"), then count by bucket.
  const prEntries = Object.values(pullRequests).flatMap((prs) =>
    prs.map((pr): [PullRequest, null] => [pr, null])
  );
  const prCounts = { open: 0, draft: 0, merged: 0, closed: 0 };
  for (const [pr] of dedupePrs(prEntries)) {
    prCounts[prBucket(pr.state)]++;
  }

  // Throughput over the last 7 days from the activity log.
  const since = now - 7 * DAY_MS;
  const recent = activity.filter((e) => e.at >= since);
  const throughput7d = {
    merged: recent.filter((e) => e.kind === "pr-merged").length,
    raised: recent.filter((e) => e.kind === "pr-raised").length,
    started: recent.filter((e) => e.kind === "agent-start").length,
  };

  const flags: string[] = [];
  if (needsYou > 0) {
    flags.push(`${needsYou} agent${needsYou === 1 ? " needs" : "s need"} you`);
  }
  if (prCounts.open > 0) {
    flags.push(`${prCounts.open} PR${prCounts.open === 1 ? "" : "s"} open for review`);
  }
  if (unassigned > 0) {
    flags.push(`${unassigned} ticket${unassigned === 1 ? "" : "s"} unassigned`);
  }

  return {
    columns,
    total,
    done,
    inProgress,
    todo,
    pctDone,
    unassigned,
    agents: { running: liveAgents.length, working, needsYou },
    prs: prCounts,
    throughput7d,
    flags,
  };
}

/**
 * Narrow a stats input to a single assignee so the panel mirrors the board's
 * assignee filter. `null` (everyone) is an identity pass-through. Filtering at
 * the input boundary keeps every downstream metric — columns, agents, PRs,
 * throughput — consistently scoped to that person's tickets.
 */
export function filterByAssignee(input: StatsInput, assignee: string | null): StatsInput {
  if (assignee === null || !input.board) return input;
  const issues = input.board.issues.filter((i) => i.assignee?.accountId === assignee);
  const keys = new Set(issues.map((i) => i.key));
  const pullRequests: Record<string, PullRequest[]> = {};
  for (const [k, prs] of Object.entries(input.pullRequests)) {
    if (keys.has(k)) pullRequests[k] = prs;
  }
  return {
    ...input,
    board: { ...input.board, issues },
    runningAgents: new Set([...input.runningAgents].filter((k) => keys.has(k))),
    pullRequests,
    activity: input.activity.filter((e) => e.issueKey != null && keys.has(e.issueKey)),
  };
}
