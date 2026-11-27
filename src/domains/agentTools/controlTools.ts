import type Anthropic from "@anthropic-ai/sdk";
import { activity } from "@/domains/activity/store";
import { runsAsChat } from "@/domains/agentChat/deliver";
import { stopAndWait } from "@/domains/agentChat/switch";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { agentRunning, sendAgentInput, stopAgent } from "@/ipc/agent";
import { interruptChatAgent } from "@/ipc/agentChat";
import { need } from "./args";
import {
  type ControlTarget,
  callerStarted,
  loadTicketOrigins,
  resolveTarget,
  runningAgentsOf,
} from "./controlTarget";
import { notYours } from "./ownership";

// Interrupting, stopping or removing what an agent started — a session from
// start_session, a ticket's agent from start_agent, or one those started in turn —
// through the same calls the UI's Interrupt and Stop make, and the Sessions page's
// recycle bin. Anything
// else is refused: the user's, other agents' and the orchestrator's are the user's.

const TARGET_REF = {
  type: "string",
  description:
    "The session's id (from start_session or list_sessions) or its exact title, or the key of a ticket whose agent you started with start_agent (e.g. PM-12).",
};

const WHOSE =
  "Only for sessions and ticket agents you started (start_session, start_agent), or ones those started; anything else is refused.";

export const CONTROL_TOOLS: Anthropic.Tool[] = [
  {
    name: "interrupt_session",
    description: `Interrupt what a session's or ticket's agent is doing now: its current turn and any subagents it's running, as the user's Esc or Interrupt does. The agent stays up and waits at its prompt, so send_to_session (or send_to_agent, for a ticket) can redirect it. ${WHOSE} Returns what was interrupted.`,
    input_schema: {
      type: "object",
      properties: { session_id: TARGET_REF },
      required: ["session_id"],
    },
  },
  {
    name: "stop_session",
    description: `Stop a session's or ticket's agent (and a session's companion agents): its process ends, its conversation and worktree are kept, and send_to_session starts a session again (start_agent a ticket). Use it once the work is delivered. ${WHOSE} Returns what was stopped.`,
    input_schema: {
      type: "object",
      properties: { session_id: TARGET_REF },
      required: ["session_id"],
    },
  },
  {
    name: "remove_session",
    description: `Remove a session you're finished with: its agents stop and it goes to trace's recycle bin, off the user's lists, where the user can restore it or delete it for good (its worktree and branch are kept until then). Not for tickets: stop_session stops a ticket's agent, and the ticket stays on its board. ${WHOSE}`,
    input_schema: {
      type: "object",
      properties: { session_id: TARGET_REF },
      required: ["session_id"],
    },
  },
];

const NAMES = new Set(CONTROL_TOOLS.map((t) => t.name));

export function isControlTool(name: string): boolean {
  return NAMES.has(name);
}

type Action = "stop" | "interrupt" | "remove";

const ACTION: Record<string, Action> = {
  interrupt_session: "interrupt",
  stop_session: "stop",
  remove_session: "remove",
};

async function interrupt(id: string): Promise<void> {
  // A chat agent's Interrupt (it stops subagents too); a terminal's is the Esc key.
  if (await runsAsChat(id)) await interruptChatAgent(id);
  else await sendAgentInput(id, "\x1b");
}

async function stop(id: string): Promise<void> {
  // What the Stop button does (`useAgentRun`), except that a stop that fails is
  // reported rather than shown as stopped.
  await stopAndWait(id).catch(async () => {
    await stopAgent(id);
    if (await agentRunning(id)) throw new Error("it didn't stop");
  });
  const board = useBoardStore.getState();
  board.setAgentRunning(id, false);
  board.clearOutput(id);
}

/** Run interrupt_session / stop_session / remove_session for the agent `caller`. Throws on refusal. */
export async function runControlTool(
  name: string,
  input: unknown,
  caller: string
): Promise<string> {
  const action = ACTION[name] ?? "interrupt";
  const tickets = await loadTicketOrigins();
  const target = resolveTarget(need(input, "session_id"), tickets);
  if (!callerStarted(target, caller, tickets)) throw new Error(notYours(target.label, action));
  if (action === "remove") return remove(target, caller);
  return act(target, action, caller);
}

/** Interrupt or stop every running agent of the target. */
async function act(target: ControlTarget, action: "stop" | "interrupt", caller: string) {
  const { label } = target;
  const ids = runningAgentsOf(target);
  if (ids.length === 0) return `"${label}" isn't running; nothing to ${action}.`;
  const failed: string[] = [];
  let done = 0;
  for (const id of ids) {
    try {
      await (action === "stop" ? stop(id) : interrupt(id));
      done += 1;
    } catch (e) {
      const own = target.kind === "session" ? target.session.id : target.key;
      const whose = id === own ? "its agent" : id;
      failed.push(`${whose}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (done === 0) throw new Error(`Couldn't ${action} "${label}": ${failed.join("; ")}`);
  activity.log({
    kind: action === "stop" ? "agent-stopped" : "agent-interrupted",
    actor: "agent",
    ...(target.kind === "session"
      ? { workspaceId: target.session.id, subject: label }
      : { issueKey: target.key }),
    title: action === "stop" ? `stopped “${label}”` : `interrupted “${label}”`,
    data: { by: caller, agents: done },
  });
  const n = done === 1 ? "its agent" : `${done} of its agents`;
  const again = target.kind === "session" ? "send_to_session" : "start_agent";
  const head =
    action === "stop"
      ? `Stopped "${label}" (${n}). ${again} starts it again.`
      : `Interrupted "${label}" (${n}). It's waiting at its prompt.`;
  return failed.length ? `${head}\nNot done for: ${failed.join("; ")}` : head;
}

/** Send a session to the recycle bin (which stops its agents backend-side). */
async function remove(target: ControlTarget, caller: string): Promise<string> {
  if (target.kind === "ticket") {
    return `${target.key} is a ticket, so it isn't removed: stop_session stops its agent, and the ticket stays on its board.`;
  }
  const { session, label } = target;
  await useSessionsStore.getState().archive(session.id);
  const board = useBoardStore.getState();
  for (const id of [session.id, ...(session.agents ?? []).map((a) => a.id)]) {
    board.setAgentRunning(id, false);
  }
  activity.log({
    kind: "session-archived",
    actor: "agent",
    workspaceId: session.id,
    subject: label,
    title: `moved “${label}” to the recycle bin`,
    data: { by: caller },
  });
  return `Removed "${label}": its agents are stopped and it's in trace's recycle bin, where the user can restore it.`;
}
