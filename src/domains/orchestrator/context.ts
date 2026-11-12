import { useActivityStore } from "@/domains/activity/store";
import { effectiveAssignee } from "@/domains/board/assignee";
import { statusOf, useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import { liveLights } from "@/domains/live/store";
import { formatBoardLines } from "./boardFormat";
import { loadBoardSetup } from "./boardSetup";
import { ensureSessionJournals, sessionStatsInput } from "./sessionContext";
import { NO_BOARD_LINES, sessionSnapshotLines } from "./sessionSnapshot";
import { computeSessionStats } from "./sessionStats";
import { computeBoardStats, filterByAssignee, type StatsInput } from "./stats";
import { useOrchestratorStore } from "./store";

// The compact board snapshot handed to the orchestrator LLM each turn. It mirrors
// what the user sees, but as terse text — every NUMBER comes from the
// deterministic stats (the model narrates, never counts). Kept lean so it caches
// cheaply and leaves room for the conversation.

/** The board's assignee filter as the board applies it (`board/assignee.ts`). */
function boardAssignee(board: ReturnType<typeof useBoardStore.getState>): string | null {
  const provider = board.provider;
  const currentUserId = provider
    ? (useIssuesStore.getState().users[provider]?.accountId ?? null)
    : null;
  return effectiveAssignee(provider, board.assigneeFilter, currentUserId);
}

/**
 * The current board as a stats input, scoped to the board's assignee filter.
 * The single source both the text snapshot and the chat charts read from, so
 * their numbers always agree. `null` when no board is loaded.
 */
export function scopedStatsInput(): StatsInput | null {
  const board = useBoardStore.getState();
  const data = board.data;
  if (!data) return null;
  const events = useActivityStore.getState().events;
  return filterByAssignee(
    {
      board: data,
      runningAgents: board.runningAgents,
      lights: liveLights(),
      pullRequests: board.pullRequests,
      activity: events,
      now: Date.now(),
    },
    boardAssignee(board)
  );
}

/** The sessions block, from the same stats the panel shows. */
function sessionLines(): string[] {
  const input = sessionStatsInput();
  return sessionSnapshotLines(computeSessionStats(input), input.now);
}

/**
 * The current board state as text for the orchestrator's system prompt (and
 * `get_board`): the board's tickets when one is loaded, plus the standalone
 * sessions and their agents — or the sessions alone when no board is.
 */
export async function buildBoardContext(): Promise<string> {
  await ensureSessionJournals();
  const board = useBoardStore.getState();
  const data = board.data;
  const input = scopedStatsInput();
  if (!data || !input) return [...NO_BOARD_LINES, "", ...sessionLines()].join("\n");

  const assignee = boardAssignee(board);
  const scopedIssues = input.board?.issues ?? data.issues;
  const stats = computeBoardStats(input);

  const scopeName =
    assignee === null
      ? "all assignees"
      : (scopedIssues.find((i) => i.assignee?.accountId === assignee)?.assignee?.displayName ??
        (board.provider
          ? useIssuesStore.getState().users[board.provider]?.displayName
          : undefined) ??
        "the selected assignee");

  const boardKey = board.boardKey ?? `${board.provider}:${data.boardId}`;
  const lines = formatBoardLines({
    boardKey,
    provider: board.provider ?? "jira",
    data,
    shown: true,
    issues: scopedIssues,
    scope: `filtered to ${scopeName} — these are the only tickets in play; never recommend or act on tickets not listed below.`,
    stats,
    agentOf: (key) => statusOf(board.runningAgents.has(key), board.agentActivity[key]),
    prs: board.pullRequests,
    setup: await loadBoardSetup(boardKey),
  });

  // Per-turn agent events would crowd out everything else in 12 lines.
  const recent = input.activity.filter((e) => e.kind !== "agent-turn-end").slice(0, 12);
  if (recent.length) {
    lines.push("", "RECENT ACTIVITY (newest first):");
    for (const e of recent) {
      lines.push(`- ${e.issueKey ? `${e.issueKey} ` : ""}${e.title} [${e.kind}]`);
    }
  }

  lines.push("", ...sessionLines());

  // The sprint goal, if set, frames everything below it.
  const goal = useOrchestratorStore.getState().sprintGoal.trim();
  return goal ? `SPRINT GOAL: ${goal}\n\n${lines.join("\n")}` : lines.join("\n");
}
