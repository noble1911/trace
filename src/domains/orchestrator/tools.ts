import type Anthropic from "@anthropic-ai/sdk";
import { transcriptText } from "@/domains/agent/transcript";
import { chatTail, runsAsChat } from "@/domains/agentChat/deliver";
import { useBoardStore } from "@/domains/board/store";
import { resolveAgentKey } from "./agentKey";
import { locateIssue } from "./boardLookup";
import { BOARD_READ_TOOLS, runGetBoard, runListBoards } from "./boardTools";
import { describeConflicts } from "./conflicts";

// Read-only tools for Phase 2. The board snapshot in the system prompt answers
// most questions; these let the model pull the two things the snapshot omits —
// a ticket's full description and an agent's live terminal output. No tool here
// mutates anything (that's Phase 3, behind a confirm gate).

export const READ_TOOLS: Anthropic.Tool[] = [
  ...BOARD_READ_TOOLS,
  {
    name: "get_ticket_details",
    description:
      "Get the full description and metadata for one ticket by key, from whichever board it is on. Use when the one-line board summary isn't enough to reason about a ticket.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "The issue key: TRACE-12 (Jira), #123 (Pylon) or local-12 (a trace board).",
        },
        board: {
          type: "string",
          description:
            "provider:boardId, when the ticket isn't on the shown board and trace can't tell where it is.",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "get_agent_transcript",
    description:
      "Read the recent output of an agent — a ticket's, or a standalone session's (pass the session id from CURRENT BOARD STATE) — to explain why it is blocked or what it is doing. Returns the tail of its terminal, or of its conversation for a chat agent.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "The issue key, or a session agent's id, whose transcript to read.",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "check_conflicts",
    description:
      "Check whether any file is being changed in more than one active worktree — a merge-conflict risk across agents working in parallel. Takes no arguments.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

function readString(input: unknown, field: string): string {
  if (input && typeof input === "object" && field in input) {
    const v = (input as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return "";
}

/** Execute a read-only tool call and return its result as text for the model. */
export async function runReadTool(name: string, input: unknown): Promise<string> {
  // Board-wide tools take no issue_key.
  if (name === "check_conflicts") return describeConflicts();
  if (name === "list_boards") return runListBoards();
  if (name === "get_board") return runGetBoard(input);

  const board = useBoardStore.getState();
  const raw = readString(input, "issue_key");
  if (!raw.trim()) return "Error: missing issue_key.";

  if (name === "get_ticket_details") {
    try {
      const { issue, board: where } = await locateIssue(raw, readString(input, "board"));
      return [
        `${issue.key}: ${issue.summary}`,
        `Board: ${where.boardKey} "${where.data.boardName}"`,
        `Type: ${issue.issueType} · Priority: ${issue.priority} · Status: ${issue.statusName}`,
        `Assignee: ${issue.assignee?.displayName ?? "unassigned"}`,
        issue.epic ? `Epic: ${issue.epic}${issue.epicKey ? ` (${issue.epicKey})` : ""}` : "",
        issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
        "",
        issue.description?.trim() || "(no description)",
      ]
        .filter(Boolean)
        .join("\n");
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  if (name === "get_agent_transcript") {
    const { key, label } = resolveAgentKey(raw);
    // A chat agent has no screen: the end of its conversation stands in for one.
    if (await runsAsChat(key)) {
      const tail = (await chatTail(key, 6_000)).trim();
      return tail ? `Recent conversation for ${label}:\n\n${tail}` : `No output for ${label} yet.`;
    }
    const chunks = board.outputBuffers[key];
    if (!chunks || chunks.length === 0) {
      return board.runningAgents.has(key)
        ? `The agent for ${label} is running but hasn't produced output yet.`
        : `No active agent for ${label}.`;
    }
    const text = transcriptText(chunks).trim();
    return text
      ? `Recent transcript for ${label}:\n\n${text}`
      : `No readable output for ${label} yet.`;
  }

  return `Unknown tool: ${name}`;
}
