import type { ActivityActor } from "@/domains/activity/types";
import { sendToAgent } from "@/domains/agentChat/deliver";
import { CARD_TOOL_NAMES, cardActionSummary, runCardTool } from "@/domains/agentTools/cardTools";
import { startOfWorkStatus } from "@/domains/board/columns";
import { useBoardStore } from "@/domains/board/store";
import { isScheduledRun } from "@/domains/schedules/ids";
import { type AgentKey, resolveAgentKey } from "./agentKey";
import { issueKeyFrom } from "./boardLookup";
import { commentTool, moveIssueTool, startAgentTool } from "./ticketActions";

export { WRITE_TOOL_NAMES, WRITE_TOOLS } from "./writeTools";

// Runs the mutating tools (defined in writeTools.ts). Every one passes through a
// human confirm-card before it runs (the gate lives in agent.ts).

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

/** Confirm-card text for start_agent — names the In Progress move when one applies. */
function startAgentSummary(key: string): string {
  const data = useBoardStore.getState().data;
  const issue = data?.issues.find((i) => i.key === key);
  if (data && issue && issue.statusCategory !== "indeterminate") {
    const target = startOfWorkStatus(data.columns);
    if (target) return `Start a coding agent on ${key} and move it to ${target.name}`;
  }
  return `Start a coding agent on ${key}`;
}

/** A short, human-readable description of a pending action for the confirm card. */
export function actionSummary(name: string, input: unknown): string {
  const key = issueKeyFrom(field(input, "issue_key"));
  switch (name) {
    case "move_issue":
      return `Move ${key} → ${clip(field(input, "target_status"), 40)}`;
    case "start_agent":
      return startAgentSummary(key);
    case "send_to_agent": {
      const { label } = resolveAgentKey(field(input, "issue_key"));
      return `Send to ${label}'s agent: "${clip(field(input, "message"))}"`;
    }
    case "comment_on_issue":
      return `Comment on ${key}: "${clip(field(input, "body"))}"`;
    case "broadcast_to_agents":
      return `Broadcast to ALL agents: "${clip(field(input, "message"))}"`;
    case "create_card":
    case "update_card":
      return cardActionSummary(name, input);
    default:
      return name;
  }
}

const ACTION_VERB: Record<string, string> = {
  move_issue: "Move",
  start_agent: "Start",
  send_to_agent: "Send",
  comment_on_issue: "Comment",
  broadcast_to_agents: "Broadcast",
  create_card: "Create",
  update_card: "Update",
};

/** The confirm card's go button: the action's verb, so the button says what it does. */
export function actionVerb(name: string): string {
  return ACTION_VERB[name] ?? "Confirm";
}

/**
 * Execute a confirmed mutating tool. Returns a result string for the model.
 * `actor` is who the activity log credits (an agent calling over MCP, or the
 * orchestrator).
 */
export async function runWriteTool(
  name: string,
  input: unknown,
  actor: ActivityActor = "orchestrator"
): Promise<string> {
  const board = useBoardStore.getState();

  if (name === "broadcast_to_agents") {
    const message = field(input, "message");
    if (!message.trim()) return "Error: empty message.";
    // Scheduled runs are excluded: they're unattended one-shot jobs, and a
    // message landing mid-run would change what the schedule asked for.
    const agents = [...board.runningAgents].filter(
      (k) => !k.startsWith("term:") && !isScheduledRun(k)
    );
    if (agents.length === 0) return "No running agents to broadcast to.";
    // A broadcast starts a turn on every agent it reaches, so each one's
    // finished turn is worth a notification again.
    const results = await Promise.allSettled(
      agents.map((k) => {
        board.noteUserTurn(k);
        return sendToAgent(k, message);
      })
    );
    const failed = agents.filter((_, i) => results[i].status === "rejected");
    const ok = agents.length - failed.length;
    return failed.length === 0
      ? `Broadcast sent to all ${agents.length} running agent(s).`
      : `Broadcast sent to ${ok}/${agents.length} — failed: ${failed.join(", ")}.`;
  }

  if (CARD_TOOL_NAMES.has(name)) return runCardTool(name, input);

  const raw = field(input, "issue_key");
  if (!raw.trim()) return "Error: missing issue_key.";
  // A session agent's id is case-sensitive; only ticket keys are normalised.
  if (name === "send_to_agent") return sendTo(resolveAgentKey(raw), field(input, "message"));
  // The ticket tools find the ticket's board themselves: the shown one, or any other.
  if (name === "move_issue") return moveIssueTool(input, actor);
  if (name === "start_agent") return startAgentTool(input, actor);
  if (name === "comment_on_issue") return commentTool(input);

  return `Unknown tool: ${name}`;
}

/** send_to_agent: a ticket's agent or a session's, once resolved. */
async function sendTo({ key, label }: AgentKey, message: string): Promise<string> {
  const board = useBoardStore.getState();
  if (!board.runningAgents.has(key)) return `No running agent on ${label} to message.`;
  if (!message.trim()) return "Error: empty message.";
  try {
    board.noteUserTurn(key);
    await sendToAgent(key, message);
    return `Sent to ${label}'s agent.`;
  } catch (e) {
    return `Couldn't send to ${label}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
