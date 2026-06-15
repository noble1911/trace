import { useActivityStore } from "@/domains/activity/store";
import { dedupePrs } from "@/domains/board/prDedupe";
import { type SessionStatus, statusOf, useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { computeBoardStats } from "./stats";
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

/** Build the current board state as text for the orchestrator's system prompt. */
export function buildBoardContext(): string {
  const board = useBoardStore.getState();
  const events = useActivityStore.getState().events;
  const data = board.data;
  if (!data) return "No board is loaded.";

  const stats = computeBoardStats({
    board: data,
    runningAgents: board.runningAgents,
    agentActivity: board.agentActivity,
    ackedWaiting: board.ackedWaiting,
    pullRequests: board.pullRequests,
    activity: events,
    now: Date.now(),
  });

  const lines: string[] = [
    `SPRINT: ${data.sprintName ?? "—"} · board "${data.boardName}"`,
    `STATS: ${stats.total} tickets · ${stats.done} done (${stats.pctDone}%) · ${stats.inProgress} in progress · ${stats.todo} to do · ${stats.unassigned} unassigned`,
    `AGENTS: ${stats.agents.running} running (${stats.agents.working} working, ${stats.agents.waiting} waiting)`,
    `PRS: ${stats.prs.open} open · ${stats.prs.draft} draft · ${stats.prs.merged} merged · ${stats.prs.closed} closed`,
  ];
  if (stats.flags.length) lines.push(`FLAGS: ${stats.flags.join("; ")}`);
  lines.push("", `COLUMNS: ${stats.columns.map((c) => `${c.name} (${c.count})`).join(" · ")}`);
  lines.push("", "TICKETS:");
  for (const issue of data.issues) {
    const agent = statusOf(board.runningAgents.has(issue.key), board.agentActivity[issue.key]);
    lines.push(ticketLine(issue, agent, board.pullRequests[issue.key]));
  }

  const recent = events.slice(0, 12);
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
