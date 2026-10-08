import type { ActivityEvent } from "@/domains/activity/types";

// What the buddy is told before each bubble: the occasion, the new events (with
// the agent's own closing words where we have them), a one-line board status,
// and what it said lately so it doesn't repeat itself.

export type Occasion = "events" | "poke" | "welcome-back";

export interface BoardGlance {
  boardName: string | null;
  working: number;
  waiting: number;
}

export interface PromptInput {
  occasion: Occasion;
  events: ActivityEvent[];
  board: BoardGlance;
  recentLines: string[];
  now: number;
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function eventLine(e: ActivityEvent, now: number): string {
  const who = e.issueKey ?? e.subject ?? "";
  const said =
    typeof e.data?.lastMessage === "string" ? ` — agent said: "${e.data.lastMessage}"` : "";
  const failing = Array.isArray(e.data?.failing) ? ` (failing: ${e.data.failing.join(", ")})` : "";
  const by =
    e.actor === "user"
      ? " [by the user]"
      : e.actor === "orchestrator"
        ? " [by the orchestrator bot]"
        : "";
  return `- ${ago(now - e.at)} · ${who ? `${who} · ` : ""}${e.title}${failing}${said} (${e.kind})${by}`;
}

const OCCASION: Record<Occasion, string> = {
  events: "Something just happened. React to the events below.",
  poke: "The user just poked you to say hi. Respond — you can mention how the board is doing.",
  "welcome-back": "The user just came back after being away. Greet them and sum up what happened.",
};

export function buildPrompt({ occasion, events, board, recentLines, now }: PromptInput): string {
  const lines = [OCCASION[occasion], ""];
  const agents =
    board.working + board.waiting === 0
      ? "no agents running"
      : `${board.working} agent(s) working, ${board.waiting} waiting on the user`;
  lines.push(`Board: ${board.boardName ?? "none loaded"} · ${agents}.`);
  if (events.length) {
    lines.push("", "Events (oldest first):");
    for (const e of [...events].sort((a, b) => a.at - b.at)) lines.push(eventLine(e, now));
  }
  if (recentLines.length) {
    lines.push("", "You said recently (don't repeat):");
    for (const l of recentLines) lines.push(`- ${l}`);
  }
  return lines.join("\n");
}
