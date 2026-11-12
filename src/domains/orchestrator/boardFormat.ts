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

/** What a board's setup adds to `get_board`; each part is left out when it couldn't be read. */
export interface BoardSetupText {
  /** The board's repos (paths); `defaultRepo` is one of them. */
  repos?: string[];
  defaultRepo?: string | null;
  /** The board's own kickoff prompt; null or blank: it uses the global one. */
  prompt?: string | null;
  /** A custom board's card types. */
  cardTypes?: { name: string; prompt: string | null }[];
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
  /** The board's settings and card types, when they could be read. */
  setup?: BoardSetupText | null;
}

const PROMPT_EXCERPT_LINES = 3;
const PROMPT_LINE_CHARS = 160;

function repoName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

/** The setup block: repos, the board's prompt (an excerpt) and card types. Empty when nothing is known. */
export function setupLines(setup: BoardSetupText | null | undefined): string[] {
  if (!setup) return [];
  const lines: string[] = [];
  if (setup.repos?.length) {
    const names = setup.repos.map(
      (r) => `${repoName(r)}${r === setup.defaultRepo ? " (default)" : ""}`
    );
    lines.push(`REPOS: ${names.join(", ")} — agents for this board's cards start in these.`);
  }
  const prompt = setup.prompt?.trim();
  if (prompt) {
    const all = prompt
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const shown = all.slice(0, PROMPT_EXCERPT_LINES).map((l) => oneLine(l, PROMPT_LINE_CHARS));
    lines.push(
      `KICKOFF PROMPT: this board has its own (excerpt: first ${shown.length} of ${all.length} lines, not the whole):`,
      ...shown.map((l) => `  > ${l}`)
    );
  } else if (prompt !== undefined) {
    lines.push("KICKOFF PROMPT: none of its own (the global one applies).");
  }
  if (setup.cardTypes?.length) {
    const types = setup.cardTypes.map(
      (t) => `${t.name}${t.prompt?.trim() ? " (has its own prompt)" : ""}`
    );
    lines.push(`CARD TYPES: ${types.join(", ")} — set one with create_card / update_card (type).`);
  }
  return lines;
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
  // A trace board's cards are all the user's: "0 unassigned" would only be noise.
  const unassigned = input.provider === "custom" ? "" : ` · ${stats.unassigned} unassigned`;
  const lines: string[] = [
    `BOARD: ${input.boardKey} "${data.boardName}"${shown ? " · shown in trace now" : ""}`,
    `SPRINT: ${data.sprintName ?? "—"} · board "${data.boardName}"`,
    `SCOPE: ${input.scope}`,
    `STATS: ${stats.total} tickets · ${stats.done} done (${stats.pctDone}%) · ${stats.inProgress} in progress · ${stats.todo} to do${unassigned}`,
    `AGENTS: ${stats.agents.running} running (${stats.agents.working} working, ${stats.agents.needsYou} need you)`,
    `PRS: ${prs ? `${stats.prs.open} open · ${stats.prs.draft} draft · ${stats.prs.merged} merged · ${stats.prs.closed} closed` : unknownPrs}`,
  ];
  if (input.provider === "custom") lines.push(CUSTOM_NOTE);
  lines.push(...setupLines(input.setup));
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
