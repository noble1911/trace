import type Anthropic from "@anthropic-ai/sdk";

// The orchestrator's mutating tool definitions (run by mutations.ts). Every one
// passes through a human confirm-card before it runs. Deliberately NO raise_pr /
// merge_pr: in this workflow the coding agents raise and merge their own PRs.

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "move_issue",
    description:
      "Move a ticket to a different board column by transitioning its status. On Jira, only legal workflow transitions succeed.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "The issue key, e.g. TRACE-12 (Jira) or #123 (Pylon).",
        },
        target_status: {
          type: "string",
          description:
            "The destination status/column name exactly as it appears on the board, e.g. 'In Progress'.",
        },
      },
      required: ["issue_key", "target_status"],
    },
  },
  {
    name: "start_agent",
    description:
      "The complete 'begin work' action for a ticket: creates its worktree, moves the ticket to the board's In Progress column (unless already in progress), and launches the session with the user's configured kickoff brief (the ticket's key, summary, description and recent discussion thread) already submitted to the agent. The agent starts working immediately. Do NOT also call move_issue for the In Progress transition, and do NOT call send_to_agent afterward to tell it to start — the kickoff brief already does that; a follow-up message would just type an unsent duplicate over it.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The issue key to start an agent on." },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "send_to_agent",
    description:
      "Send a line of input to an agent that is ALREADY running, as if typed into its terminal and followed by Enter. Use only to answer a question or nudge a blocked/waiting agent mid-task — NOT to start work on a freshly started agent (start_agent already delivers and submits the kickoff brief).",
    input_schema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "The issue key whose agent to message, or a session agent's id.",
        },
        message: { type: "string", description: "The text to send to the agent." },
      },
      required: ["issue_key", "message"],
    },
  },
  {
    name: "comment_on_issue",
    description:
      "Add a comment to a ticket. Use to record a decision or a summary on the issue itself.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The issue key to comment on." },
        body: {
          type: "string",
          description: "The comment text (plain text; newlines become paragraphs).",
        },
      },
      required: ["issue_key", "body"],
    },
  },
  {
    name: "broadcast_to_agents",
    description:
      "Send the same line of input to every running agent at once (each followed by Enter). Use for a fleet-wide instruction, e.g. 'rebase onto the latest main'.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text to send to all running agents." },
      },
      required: ["message"],
    },
  },
];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));
