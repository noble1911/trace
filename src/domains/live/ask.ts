import type { AgentAsk } from "@/ipc/events";
import type { Ask } from "./types";

const BLANK: Pick<Ask, "tool" | "detail" | "options" | "canAlways"> = {
  tool: null,
  detail: null,
  options: [],
  canAlways: null,
};

/** The tool named in an older CLI's notification ("…permission to use Bash"). */
function toolIn(message: string | null | undefined): string | null {
  return message?.match(/permission to use ([\w:.-]+)/)?.[1] ?? null;
}

/** `mcp__server__tool` reads as `server · tool`; built-in tools as themselves. */
function toolLabel(tool: string): string {
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : tool;
}

/**
 * What a permission dialog is for, from the PermissionRequest hook — the only
 * signal that tells a question or a plan from a real permission prompt (the
 * Notification for all three is the same "Claude needs your permission").
 */
export function askFromTool(e: AgentAsk): Ask {
  if (e.tool === "AskUserQuestion") {
    // Only one single-choice question is a plain menu we can answer from outside.
    const answerable = e.questions === 1 && !e.multiSelect;
    return {
      kind: "question",
      label: "Question",
      tool: e.tool,
      detail: e.detail,
      options: answerable ? e.options : [],
      canAlways: false,
    };
  }
  if (e.tool === "ExitPlanMode") {
    return {
      kind: "plan",
      label: "Plan approval",
      tool: e.tool,
      detail: e.detail,
      options: [],
      canAlways: false,
    };
  }
  return {
    kind: "permission",
    label: `Permission · ${toolLabel(e.tool)}`,
    tool: e.tool,
    detail: e.detail,
    options: [],
    canAlways: e.canAlwaysAllow,
  };
}

/**
 * A Notification hook's ask, for agents whose PermissionRequest didn't say
 * more. Without a named tool it could be a question as easily as a permission,
 * so it gets no answer buttons — just "Needs you".
 */
export function askFrom(type: string | null | undefined, message: string | null | undefined): Ask {
  const tool = toolIn(message);
  if (type === "elicitation_dialog" || type === "elicitation_url_dialog") {
    return { ...BLANK, kind: "question", label: "Question" };
  }
  if (type === "agent_needs_input") return { ...BLANK, kind: "input", label: "Needs input" };
  if (tool) return { ...BLANK, kind: "permission", label: `Permission · ${toolLabel(tool)}`, tool };
  return { ...BLANK, kind: "input", label: "Needs you" };
}

/** A finished turn nobody has looked at yet — the quiet-timer kind of "needs you". */
export const TURN_FINISHED: Ask = { ...BLANK, kind: "turn", label: "Turn finished" };
