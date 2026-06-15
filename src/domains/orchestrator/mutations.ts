import type Anthropic from "@anthropic-ai/sdk";
import { activity } from "@/domains/activity/store";
import { useBoardStore } from "@/domains/board/store";
import { sendAgentInput } from "@/ipc/agent";
import { commentOnIssue, transitionJiraIssue } from "@/ipc/jira";

// Mutating tools. Every one passes through a human confirm-card before it runs
// (the gate lives in agent.ts). Deliberately NO raise_pr / merge_pr: in this
// workflow the coding agents raise and merge their own PRs.

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "move_issue",
    description:
      "Move a ticket to a different board column by transitioning its Jira status. Only legal workflow transitions succeed.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The Jira issue key, e.g. TRACE-12." },
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
      "Start a Claude coding agent on a ticket — creates its worktree and launches the session with the kickoff brief. Use to begin work on the next ticket.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The Jira issue key to start an agent on." },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "send_to_agent",
    description:
      "Send a line of input to the running agent on a ticket, as if typed into its terminal and followed by Enter. Use to nudge or unblock a waiting agent.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The Jira issue key whose agent to message." },
        message: { type: "string", description: "The text to send to the agent." },
      },
      required: ["issue_key", "message"],
    },
  },
  {
    name: "comment_on_issue",
    description:
      "Add a comment to a Jira ticket. Use to record a decision or a summary on the issue itself.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The Jira issue key to comment on." },
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

function field(input: unknown, key: string): string {
  if (input && typeof input === "object" && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return "";
}

function clip(s: string, n = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** A short, human-readable description of a pending action for the confirm card. */
export function actionSummary(name: string, input: unknown): string {
  const key = field(input, "issue_key").toUpperCase();
  switch (name) {
    case "move_issue":
      return `Move ${key} → ${clip(field(input, "target_status"), 40)}`;
    case "start_agent":
      return `Start a coding agent on ${key}`;
    case "send_to_agent":
      return `Send to ${key}'s agent: "${clip(field(input, "message"))}"`;
    case "comment_on_issue":
      return `Comment on ${key}: "${clip(field(input, "body"))}"`;
    case "broadcast_to_agents":
      return `Broadcast to ALL agents: "${clip(field(input, "message"))}"`;
    default:
      return name;
  }
}

/** Execute a confirmed mutating tool. Returns a result string for the model. */
export async function runWriteTool(name: string, input: unknown): Promise<string> {
  const board = useBoardStore.getState();

  if (name === "broadcast_to_agents") {
    const message = field(input, "message");
    if (!message.trim()) return "Error: empty message.";
    const agents = [...board.runningAgents].filter((k) => !k.startsWith("term:"));
    if (agents.length === 0) return "No running agents to broadcast to.";
    const results = await Promise.allSettled(agents.map((k) => sendAgentInput(k, `${message}\r`)));
    const failed = agents.filter((_, i) => results[i].status === "rejected");
    const ok = agents.length - failed.length;
    return failed.length === 0
      ? `Broadcast sent to all ${agents.length} running agent(s).`
      : `Broadcast sent to ${ok}/${agents.length} — failed: ${failed.join(", ")}.`;
  }

  const key = field(input, "issue_key").trim().toUpperCase();
  if (!key) return "Error: missing issue_key.";

  if (name === "move_issue") {
    const data = board.data;
    if (!data) return "No board is loaded.";
    const issue = data.issues.find((i) => i.key === key);
    if (!issue) return `No ticket ${key} on the board.`;
    const want = field(input, "target_status").trim().toLowerCase();
    // The model names what it sees in the snapshot — a COLUMN. Match that first;
    // fall back to a specific status name. Pass every candidate status id so
    // transitionJiraIssue picks whichever transition the workflow allows.
    const column = data.columns.find((c) => c.name.toLowerCase() === want);
    const statuses = column
      ? column.statuses
      : data.columns.flatMap((c) => c.statuses).filter((s) => s.name.toLowerCase() === want);
    if (statuses.length === 0) {
      const names = data.columns.map((c) => c.name).join(", ");
      return `No column or status named "${field(input, "target_status")}". Board columns: ${names}.`;
    }
    const targetName = column ? column.name : statuses[0].name;
    if (statuses.some((s) => s.id === issue.statusId)) {
      return `${key} is already in ${targetName}.`;
    }
    // Raw transition (not the board's optimistic moveIssue) so we report real
    // success/failure to the model, then resync the board.
    try {
      await transitionJiraIssue(
        key,
        statuses.map((s) => s.id)
      );
      activity.log({ kind: "transition", issueKey: key, title: `→ ${targetName}` });
      await board.refresh();
      return `Moved ${key} to ${targetName}.`;
    } catch (e) {
      return `Couldn't move ${key}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (name === "start_agent") {
    if (board.runningAgents.has(key)) return `An agent is already running on ${key}.`;
    if (!board.data?.issues.some((i) => i.key === key)) return `No ticket ${key} on the board.`;
    board.kickoff(key);
    return `Starting an agent on ${key}.`;
  }

  if (name === "send_to_agent") {
    if (!board.runningAgents.has(key)) return `No running agent on ${key} to message.`;
    const message = field(input, "message");
    if (!message.trim()) return "Error: empty message.";
    try {
      await sendAgentInput(key, `${message}\r`);
      return `Sent to ${key}'s agent.`;
    } catch (e) {
      return `Couldn't send to ${key}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (name === "comment_on_issue") {
    const body = field(input, "body");
    if (!body.trim()) return "Error: empty comment.";
    try {
      await commentOnIssue(key, body);
      return `Commented on ${key}.`;
    } catch (e) {
      return `Couldn't comment on ${key}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return `Unknown tool: ${name}`;
}
