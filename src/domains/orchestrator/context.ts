import { useActivityStore } from "@/domains/activity/store";
import { dedupePrs } from "@/domains/board/prDedupe";
import { type SessionStatus, statusOf, useBoardStore } from "@/domains/board/store";
import { useJiraStore } from "@/domains/jira/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { computeBoardStats, filterByAssignee } from "./stats";
import { useOrchestratorStore } from "./store";

// The compact board snapshot handed to the orchestrator LLM each turn. It mirrors
// what the user sees, but as terse text — every NUMBER comes from the
// deterministic stats (the model narrates, never counts). Kept lean so it caches
// cheaply and leaves room for the conversation.

function oneLine(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The most-final PR for an issue (a stale "open" hidden behind "merged"). */
function issuePrTag(prs: PullRequest[] | undefined): string {
  if (!prs || prs.length === 0) return "";
  const [top] = dedupePrs(prs.map((pr): [PullRequest, null] => [pr, null]));
  return top ? ` PR#${top[0].number}(${top[0].state})` : "";
}

function ticketLine(issue: Issue, agent: SessionStatus, prs: PullRequest[] | undefined): string {
  const assignee = issue.assignee?.displayName ?? "unassigned";
  const epic = issue.epic ? ` epic="${oneLine(issue.epic, 28)}"` : "";
  const agentTag = agent !== "idle" ? ` agent=${agent}` : "";
  const head = `- ${issue.key} [${issue.priority}] ${issue.issueType} · ${issue.statusName} · ${assignee}`;
  return `${head}${epic}${agentTag}${issuePrTag(prs)}\n  ${oneLine(issue.summary, 100)}`;
}

/** Resolve the board's effective assignee filter (undefined → the current user). */
function effectiveAssignee(board: ReturnType<typeof useBoardStore.getState>): string | null {
  const currentUserId = useJiraStore.getState().user?.accountId ?? null;
  return board.assigneeFilter === undefined ? currentUserId : board.assigneeFilter;
}

/** Build the current board state as text for the orchestrator's system prompt. */
export function buildBoardContext(): string {
  const board = useBoardStore.getState();
  const events = useActivityStore.getState().events;
  const data = board.data;
  if (!data) return "No board is loaded.";

  // Scope to the same assignee the board is filtered by, so the assistant only
  // reasons about (and recommends) tickets the user is actually looking at.
  const assignee = effectiveAssignee(board);
  const input = filterByAssignee(
    {
      board: data,
      runningAgents: board.runningAgents,
      agentActivity: board.agentActivity,
      ackedWaiting: board.ackedWaiting,
      pullRequests: board.pullRequests,
      activity: events,
      now: Date.now(),
    },
    assignee
  );
  const scopedIssues = input.board?.issues ?? data.issues;
  const stats = computeBoardStats(input);

  const scopeName =
    assignee === null
      ? "all assignees"
      : (scopedIssues.find((i) => i.assignee?.accountId === assignee)?.assignee?.displayName ??
        useJiraStore.getState().user?.displayName ??
        "the selected assignee");

  const lines: string[] = [
    `SPRINT: ${data.sprintName ?? "—"} · board "${data.boardName}"`,
    `SCOPE: filtered to ${scopeName} — these are the only tickets in play; never recommend or act on tickets not listed below.`,
    `STATS: ${stats.total} tickets · ${stats.done} done (${stats.pctDone}%) · ${stats.inProgress} in progress · ${stats.todo} to do · ${stats.unassigned} unassigned`,
    `AGENTS: ${stats.agents.running} running (${stats.agents.working} working, ${stats.agents.waiting} waiting)`,
    `PRS: ${stats.prs.open} open · ${stats.prs.draft} draft · ${stats.prs.merged} merged · ${stats.prs.closed} closed`,
  ];
  if (stats.flags.length) lines.push(`FLAGS: ${stats.flags.join("; ")}`);
  lines.push("", `COLUMNS: ${stats.columns.map((c) => `${c.name} (${c.count})`).join(" · ")}`);
  const doneCol = data.columns.find((c) => c.statuses.some((s) => s.category === "done"));
  if (doneCol) {
    lines.push(
      `COMPLETION COLUMN: "${doneCol.name}" — move a ticket here once its work is finished (e.g. its PR is merged).`
    );
  }
  lines.push("", "TICKETS:");
  for (const issue of scopedIssues) {
    const agent = statusOf(board.runningAgents.has(issue.key), board.agentActivity[issue.key]);
    lines.push(ticketLine(issue, agent, board.pullRequests[issue.key]));
  }

  const recent = input.activity.slice(0, 12);
  if (recent.length) {
    lines.push("", "RECENT ACTIVITY (newest first):");
    for (const e of recent) {
      lines.push(`- ${e.issueKey ? `${e.issueKey} ` : ""}${e.title} [${e.kind}]`);
    }
  }

  // The sprint goal, if set, frames everything below it.
  const goal = useOrchestratorStore.getState().sprintGoal.trim();
  return goal ? `SPRINT GOAL: ${goal}\n\n${lines.join("\n")}` : lines.join("\n");
}
