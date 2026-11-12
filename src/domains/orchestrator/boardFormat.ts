import { dedupePrs } from "../board/prDedupe.ts";
import type { BoardData, BoardSummary, Issue, ProviderKind, PullRequest } from "../issues/types.ts";
import type { BoardStats } from "./stats.ts";

// A board as text for a model: `get_board`, and the assistant's per-turn snapshot. Pure
// (the caller reads the stores and passes in what it knows), so `npm test` can load it.

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

function ticketLine(issue: Issue, agent: string, prs: PullRequest[] | undefined): string {
  const assignee = issue.assignee?.displayName ?? "unassigned";
  const epic = issue.epic ? ` epic="${oneLine(issue.epic, 28)}"` : "";
  const agentTag = agent !== "idle" ? ` agent=${agent}` : "";
  const head = `- ${issue.key} [${issue.priority}] ${issue.issueType} · ${issue.statusName} · ${assignee}`;
  return `${head}${epic}${agentTag}${issuePrTag(prs)}\n  ${oneLine(issue.summary, 100)}`;
}

/** What the formatter needs: the board, and what the caller knows about it. */
export interface BoardTextInput {
  /** The switcher key, `provider:boardId`. */
  boardKey: string;
  provider: ProviderKind;
  data: BoardData;
  /** Whether this is the board the UI shows (its scope, agents and PRs are then known). */
  shown: boolean;
  /** The tickets in play (the shown board is filtered to an assignee). */
  issues: Issue[];
  /** The SCOPE line's text. */
  scope: string;
  stats: BoardStats;
  /** A ticket's agent: `idle`, `working` or `waiting`. */
  agentOf: (issueKey: string) => string;
  /** PRs by issue key, or null when unknown (only the shown board's are watched). */
  prs: Record<string, PullRequest[]> | null;
}

const CUSTOM_NOTE =
  "TRACE BOARD: kept in trace, not in a tracker. Create cards with create_card and edit them with update_card (board: this board's key). Its columns belong to the user.";

/** The board's COLUMNS block: each column with its statuses and their categories. */
function columnLines(input: BoardTextInput): string[] {
  const counts = new Map(input.stats.columns.map((c) => [c.name, c.count]));
  const lines = ["COLUMNS (in board order; each with its statuses [category]):"];
  for (const col of input.data.columns) {
    const statuses = col.statuses.map((s) => `${s.name} [${s.category}]`).join(", ");
    lines.push(`- ${col.name} (${counts.get(col.name) ?? 0}): ${statuses || "no statuses"}`);
  }
  return lines;
}

/** The board's lines: header, stats, columns, tickets. The caller adds what follows. */
export function formatBoardLines(input: BoardTextInput): string[] {
  const { data, stats, shown, prs } = input;
  const unknownPrs = "unknown (only the board shown in trace has its PRs watched)";
  const lines: string[] = [
    `BOARD: ${input.boardKey} "${data.boardName}"${shown ? " · shown in trace now" : ""}`,
    `SPRINT: ${data.sprintName ?? "—"} · board "${data.boardName}"`,
    `SCOPE: ${input.scope}`,
    `STATS: ${stats.total} tickets · ${stats.done} done (${stats.pctDone}%) · ${stats.inProgress} in progress · ${stats.todo} to do · ${stats.unassigned} unassigned`,
    `AGENTS: ${stats.agents.running} running (${stats.agents.working} working, ${stats.agents.needsYou} need you)`,
    `PRS: ${prs ? `${stats.prs.open} open · ${stats.prs.draft} draft · ${stats.prs.merged} merged · ${stats.prs.closed} closed` : unknownPrs}`,
  ];
  if (input.provider === "custom") lines.push(CUSTOM_NOTE);
  if (stats.flags.length) lines.push(`FLAGS: ${stats.flags.join("; ")}`);
  lines.push("", ...columnLines(input));
  const doneCol = data.columns.find((c) => c.statuses.some((s) => s.category === "done"));
  if (doneCol) {
    lines.push(
      `COMPLETION COLUMN: "${doneCol.name}" — move a ticket here once its work is finished (e.g. its PR is merged).`
    );
  }
  lines.push("", "TICKETS:");
  for (const issue of input.issues) {
    lines.push(ticketLine(issue, input.agentOf(issue.key), prs?.[issue.key]));
  }
  return lines;
}

/** One tracker's part of `list_boards`: its boards, or why they couldn't be listed. */
export interface BoardListGroup {
  provider: ProviderKind;
  boards?: BoardSummary[];
  error?: string;
}

const TRACKER_LABEL: Record<ProviderKind, string> = {
  jira: "Jira",
  pylon: "Pylon",
  custom: "Trace boards (kept in trace: cards can be created and edited)",
};

/** `list_boards`' text: each board as `provider:boardId`, its name and type, and the shown one marked. */
export function formatBoardList(groups: BoardListGroup[], shownKey: string | null): string {
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`${TRACKER_LABEL[g.provider]}:`);
    if (g.error) lines.push(`  couldn't list its boards: ${g.error}`);
    else if (!g.boards?.length) lines.push("  no boards");
    for (const b of g.boards ?? []) {
      const key = `${g.provider}:${b.id}`;
      lines.push(`- ${key} "${b.name}" (${b.boardType})${key === shownKey ? " — shown now" : ""}`);
    }
  }
  if (!shownKey) lines.push("", "No board is shown in trace right now.");
  lines.push("", "Read one with get_board (board: the key above).");
  return lines.join("\n");
}
