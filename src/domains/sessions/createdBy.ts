import type { CreatedBy, ScratchSession } from "./types.ts";

// Reading a session's `createdBy`. Pure (relative `.ts` imports) so `npm test`
// can load it.

const USER: CreatedBy = { kind: "user" };

/** Who started it; a session from before this was recorded reads as the user. */
export function creatorOf(session: ScratchSession): CreatedBy {
  return session.createdBy ?? USER;
}

/** Started by something other than the user. */
export function startedByOther(session: ScratchSession): boolean {
  return creatorOf(session).kind !== "user";
}

/** One key per distinct creator, for grouping. */
export function creatorKey(cb: CreatedBy): string {
  switch (cb.kind) {
    case "user":
      return "user";
    case "orchestrator":
      return "orchestrator";
    case "agent":
      return `agent:${cb.workspaceId}`;
    case "schedule":
      return `schedule:${cb.promptId}`;
    case "peer":
      return `peer:${cb.label}`;
  }
}

/** The creator as it reads after "by": "you", a session's title, a ticket key. */
export function creatorLabel(cb: CreatedBy): string {
  switch (cb.kind) {
    case "user":
      return "you";
    case "orchestrator":
      return "the orchestrator";
    case "agent":
    case "schedule":
    case "peer":
      return cb.label;
  }
}

/** What kind of thing started it, for a tooltip: "Session", "Ticket agent", … */
export function creatorKind(cb: CreatedBy): string {
  switch (cb.kind) {
    case "user":
      return "You";
    case "orchestrator":
      return "The orchestrator";
    case "agent":
      return cb.parent === "ticket" ? "Ticket agent" : "Session";
    case "schedule":
      return "Scheduled prompt";
    case "peer":
      return "Another computer";
  }
}

/** The session id an agent-started session's parent is, if it's a session. */
export function parentSessionId(session: ScratchSession): string | null {
  const cb = creatorOf(session);
  return cb.kind === "agent" && cb.parent === "session" ? cb.workspaceId : null;
}

/** Sessions started by the agent in `workspaceId` (a session id or an issue key). */
export function sessionsStartedBy(
  sessions: readonly ScratchSession[],
  workspaceId: string
): ScratchSession[] {
  return sessions.filter((s) => {
    const cb = creatorOf(s);
    return cb.kind === "agent" && cb.workspaceId === workspaceId && !s.archivedAt;
  });
}
