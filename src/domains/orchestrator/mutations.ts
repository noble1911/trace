import { activity } from "@/domains/activity/store";
import type { ActivityActor } from "@/domains/activity/types";
import { sendToAgent } from "@/domains/agentChat/deliver";
import { startOfWorkStatus } from "@/domains/board/columns";
import { useBoardStore } from "@/domains/board/store";
import { isScheduledRun } from "@/domains/schedules/ids";
import { commentOnIssue, transitionIssue } from "@/ipc/issues";
import { type AgentKey, resolveAgentKey } from "./agentKey";

export { WRITE_TOOL_NAMES, WRITE_TOOLS } from "./writeTools";

// Runs the mutating tools (defined in writeTools.ts). Every one passes through a
// human confirm-card before it runs (the gate lives in agent.ts).

/** How a tool that needs a tracker answers when none is loaded. */
export const NO_BOARD = "No board is connected (no Jira or Pylon board is loaded),";

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
  const key = field(input, "issue_key").toUpperCase();
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
    default:
      return name;
  }
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

  const raw = field(input, "issue_key");
  if (!raw.trim()) return "Error: missing issue_key.";
  // A session agent's id is case-sensitive; only ticket keys are upper-cased.
  if (name === "send_to_agent") return sendTo(resolveAgentKey(raw), field(input, "message"));
  const key = raw.trim().toUpperCase();

  if (name === "move_issue") {
    const data = board.data;
    if (!data) return `${NO_BOARD} so there's no ticket to move.`;
    const issue = data.issues.find((i) => i.key === key);
    if (!issue) return `No ticket ${key} on the board.`;
    const want = field(input, "target_status").trim().toLowerCase();
    // The model names what it sees in the snapshot — a COLUMN. Match that first;
    // fall back to a specific status name. Pass every candidate status id so
    // transitionIssue picks whichever transition the workflow allows.
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
    if (!board.provider) return `${NO_BOARD} so there's no ticket to move.`;
    try {
      await transitionIssue(
        board.provider,
        key,
        statuses.map((s) => s.id)
      );
      activity.log({
        kind: "transition",
        actor,
        issueKey: key,
        title: `→ ${targetName}`,
      });
      await board.refresh();
      return `Moved ${key} to ${targetName}.`;
    } catch (e) {
      return `Couldn't move ${key}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (name === "start_agent") {
    const data = board.data;
    if (!data) {
      return `${NO_BOARD} so start_agent has no ticket to start. For work that isn't a ticket, the user can start a session from the Sessions page.`;
    }
    const issue = data.issues.find((i) => i.key === key);
    if (!issue) return `No ticket ${key} on the board.`;
    if (board.runningAgents.has(key)) return `An agent is already running on ${key}.`;

    // Move to In Progress first (mirrors dragging a card there to begin work),
    // unless it's already in an in-progress column.
    let moved = "";
    if (issue.statusCategory !== "indeterminate") {
      const target = startOfWorkStatus(data.columns);
      if (target) {
        try {
          if (!board.provider) throw new Error("no provider");
          await transitionIssue(board.provider, key, [target.id]);
          activity.log({
            kind: "transition",
            actor,
            issueKey: key,
            title: `→ ${target.name}`,
          });
          moved = ` and moved it to ${target.name}`;
        } catch (e) {
          // A transition failure shouldn't block the agent — surface it and go on.
          moved = ` (couldn't move it: ${e instanceof Error ? e.message : String(e)})`;
        }
      }
    }
    board.kickoff(key, actor);
    await board.refresh();
    return `Started an agent on ${key}${moved}. It's been handed the kickoff brief and is working — no follow-up message is needed.`;
  }

  if (name === "comment_on_issue") {
    const body = field(input, "body");
    if (!body.trim()) return "Error: empty comment.";
    if (!board.provider) return `${NO_BOARD} so there's no ticket to comment on.`;
    try {
      await commentOnIssue(board.provider, key, body);
      return `Commented on ${key}.`;
    } catch (e) {
      return `Couldn't comment on ${key}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

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
