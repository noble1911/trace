import type Anthropic from "@anthropic-ai/sdk";
import { transcriptText } from "@/domains/agent/transcript";
import { useBoardStore } from "@/domains/board/store";
import { describeConflicts } from "./conflicts";

// Read-only tools for Phase 2. The board snapshot in the system prompt answers
// most questions; these let the model pull the two things the snapshot omits —
// a ticket's full description and an agent's live terminal output. No tool here
// mutates anything (that's Phase 3, behind a confirm gate).

export const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_ticket_details",
    description:
      "Get the full description and metadata for one Jira ticket by key. Use when the one-line board summary isn't enough to reason about a ticket.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The Jira issue key, e.g. TRACE-12." },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "get_agent_transcript",
    description:
      "Read the recent terminal output of the Claude agent working on a ticket — use to explain why an agent is blocked or what it is doing. Returns the tail of the live PTY scrollback.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "The Jira issue key whose agent transcript to read.",
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

  const board = useBoardStore.getState();
  const key = readString(input, "issue_key").trim().toUpperCase();
  if (!key) return "Error: missing issue_key.";

  if (name === "get_ticket_details") {
    const issue = board.data?.issues.find((i) => i.key === key);
    if (!issue) return `No ticket ${key} on the current board.`;
    return [
      `${issue.key}: ${issue.summary}`,
      `Type: ${issue.issueType} · Priority: ${issue.priority} · Status: ${issue.statusName}`,
      `Assignee: ${issue.assignee?.displayName ?? "unassigned"}`,
      issue.epic ? `Epic: ${issue.epic}${issue.epicKey ? ` (${issue.epicKey})` : ""}` : "",
      issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
      "",
      issue.description?.trim() || "(no description)",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (name === "get_agent_transcript") {
    const chunks = board.outputBuffers[key];
    if (!chunks || chunks.length === 0) {
      return board.runningAgents.has(key)
        ? `The agent for ${key} is running but hasn't produced output yet.`
        : `No active agent for ${key}.`;
    }
    const text = transcriptText(chunks).trim();
    return text ? `Recent transcript for ${key}:\n\n${text}` : `No readable output for ${key} yet.`;
  }

  return `Unknown tool: ${name}`;
}
