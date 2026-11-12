import type Anthropic from "@anthropic-ai/sdk";
import { str } from "@/domains/agentTools/args";
import { statusOf, useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import type { ProviderKind } from "@/domains/issues/types";
import { liveLights } from "@/domains/live/store";
import { listBoards } from "@/ipc/issues";
import { agentsOnBoard } from "./boardAgents";
import { type BoardListGroup, formatBoardLines, formatBoardList } from "./boardFormat";
import { type LoadedBoard, loadBoard, shownBoardKey } from "./boardLookup";
import { loadBoardSetup } from "./boardSetup";
import { buildBoardContext } from "./context";
import { computeBoardStats } from "./stats";

// list_boards and get_board: reading any board, not only the one shown in the UI.

export const BOARD_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_boards",
    description:
      "List every board you can read: each connected tracker's (Jira, Pylon) and the boards kept in trace. Each is given as provider:boardId with its name and type; the one shown in trace now is marked. Takes no arguments.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_board",
    description:
      "Read a board: its columns with their statuses and categories, its repos, its own kickoff prompt (first lines) and, on a trace board, its card types; every ticket in scope (key, status, type, epic, assignee, agent and PR state) and recent activity. Without board, the one shown in trace now, which is where to start before moving tickets or starting agents. A board that isn't shown is read as it stands: its PR state is unknown.",
    input_schema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          description: "provider:boardId as list_boards shows, e.g. jira:42 or custom:abc.",
        },
      },
      required: [],
    },
  },
];

const PROVIDERS: ProviderKind[] = ["jira", "pylon", "custom"];

/** list_boards: every connected tracker's boards, and trace's own. One tracker failing doesn't hide the rest. */
export async function runListBoards(): Promise<string> {
  const connected = useIssuesStore.getState().sessions;
  const groups: BoardListGroup[] = [];
  for (const provider of PROVIDERS.filter((p) => p === "custom" || connected[p])) {
    try {
      groups.push({ provider, boards: await listBoards(provider) });
    } catch (e) {
      groups.push({ provider, error: String(e instanceof Error ? e.message : e) });
    }
  }
  return formatBoardList(groups, shownBoardKey());
}

/** A board that isn't the shown one, as text: nothing in it is scoped to an assignee. */
async function describeOtherBoard(board: LoadedBoard): Promise<string> {
  const { boardKey, provider, data } = board;
  const store = useBoardStore.getState();
  const stats = computeBoardStats({
    board: data,
    // Only this board's tickets' agents, not every agent trace runs.
    runningAgents: agentsOnBoard(store.runningAgents, data.issues),
    lights: liveLights(),
    pullRequests: {},
    activity: [],
    now: Date.now(),
  });
  return formatBoardLines({
    boardKey,
    provider,
    data,
    shown: board.shown,
    issues: data.issues,
    scope: "all tickets of the board as fetched (no assignee filter).",
    stats,
    agentOf: (key) => statusOf(store.runningAgents.has(key), store.agentActivity[key]),
    prs: null,
    setup: await loadBoardSetup(boardKey),
  }).join("\n");
}

/** get_board: the shown board (as the assistant's snapshot has it), or any other by reference. */
export async function runGetBoard(input: unknown): Promise<string> {
  const ref = str(input, "board");
  if (!ref) return buildBoardContext();
  try {
    // `loadBoard` matches the parsed key, so `Custom:abc` or a padded ref is still the shown one.
    const board = await loadBoard(ref);
    return board.shown ? await buildBoardContext() : await describeOtherBoard(board);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
