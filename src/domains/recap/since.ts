import type { ActivityEvent } from "@/domains/activity/types";

// "Since you looked": what happened to one agent between the user's last visit
// and now, from the activity log. Facts only, no model: a turn count, PRs, CI,
// moves and asks, in the order they happened. Pure, so it's tested.

const MAX_PARTS = 5;

/** Whether an event belongs to this workspace (sessions log by workspace, tickets by key). */
function isFor(e: ActivityEvent, workspaceId: string): boolean {
  return e.workspaceId === workspaceId || e.issueKey === workspaceId;
}

/** One event as a short phrase, or null when it isn't news on its own. */
function phrase(e: ActivityEvent): string | null {
  switch (e.kind) {
    case "pr-raised":
    case "pr-merged":
    case "checks-failed":
    case "checks-passed":
    case "agent-needs-input":
    case "agent-interrupted":
    case "agent-stopped":
    case "session-archived":
      return e.title;
    case "transition":
      return `moved ${e.title}`;
    case "agent-exit":
      return "agent stopped";
    default:
      return null;
  }
}

/**
 * One line of what changed between `seenAt` and `until` (the start of this visit,
 * so what happens while the user watches isn't "since"), or null when nothing did
 * or the user has never opened it.
 */
export function sinceLine(
  events: readonly ActivityEvent[],
  workspaceId: string,
  seenAt: number,
  until = Number.POSITIVE_INFINITY
): string | null {
  if (seenAt <= 0) return null;
  const mine = events
    .filter((e) => e.at > seenAt && e.at <= until && e.actor !== "user" && isFor(e, workspaceId))
    .sort((a, b) => a.at - b.at);
  const turns = mine.filter((e) => e.kind === "agent-turn-end").length;
  const parts: string[] = [];
  if (turns > 0) parts.push(turns === 1 ? "finished a turn" : `finished ${turns} turns`);
  for (const e of mine) {
    const p = phrase(e);
    if (p && !parts.includes(p)) parts.push(p);
  }
  if (parts.length === 0) return null;
  const shown = parts.length > MAX_PARTS ? [...parts.slice(0, MAX_PARTS - 1), "…"] : parts;
  const line = shown.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** "2h", "15m", "3d": how long ago the user last looked. */
export function agoLabel(seenAt: number, now: number): string {
  const mins = Math.max(1, Math.round((now - seenAt) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
