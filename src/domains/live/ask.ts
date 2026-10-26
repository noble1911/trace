import type { Ask } from "./types";

// Tools whose permission prompt is really a different kind of question.
const PLAN_TOOLS = new Set(["ExitPlanMode"]);
const QUESTION_TOOLS = new Set(["AskUserQuestion"]);

/** The tool named in a notification like "Claude needs your permission to use Bash". */
function toolIn(message: string | null | undefined): string | null {
  return message?.match(/permission to use ([\w:.-]+)/)?.[1] ?? null;
}

/**
 * Turn a Notification hook's type + text into what the agent is asking for.
 * An untyped notification (older CLI) is still a request for a human.
 */
export function askFrom(type: string | null | undefined, message: string | null | undefined): Ask {
  const tool = toolIn(message);
  if (type === "permission_prompt" || type === "worker_permission_prompt") {
    if (tool && PLAN_TOOLS.has(tool)) return { kind: "plan", label: "Plan approval", tool };
    if (tool && QUESTION_TOOLS.has(tool)) return { kind: "question", label: "Question", tool };
    return { kind: "permission", label: tool ? `Permission · ${tool}` : "Permission", tool };
  }
  if (type === "elicitation_dialog" || type === "elicitation_url_dialog") {
    return { kind: "question", label: "Question", tool: null };
  }
  if (type === "agent_needs_input") return { kind: "input", label: "Needs input", tool: null };
  return { kind: "input", label: tool ? `Permission · ${tool}` : "Needs you", tool };
}

/** A finished turn nobody has looked at yet — the quiet-timer kind of "needs you". */
export const TURN_FINISHED: Ask = { kind: "turn", label: "Turn finished", tool: null };
