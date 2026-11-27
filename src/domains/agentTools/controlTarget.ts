import { useBoardStore } from "@/domains/board/store";
import { issueKeyFrom } from "@/domains/orchestrator/boardLookup";
import { useSessionsStore } from "@/domains/sessions/store";
import type { ScratchSession } from "@/domains/sessions/types";
import { issueOrigins } from "@/ipc/issueOrigins";
import { startedByCaller, type TicketOrigins, ticketStartedByCaller } from "./ownership";
import { findSession } from "./sessionTools";

// What interrupt_session, stop_session and remove_session act on: a session (by
// id or exact title) or a ticket's agent (by its key), and whether the calling
// agent started it, directly or through what it started.

export type ControlTarget =
  | { kind: "session"; session: ScratchSession; label: string }
  | { kind: "ticket"; key: string; label: string };

/** The session or ticket `ref` names. Throws the sentence the agent is told. */
export function resolveTarget(ref: string, tickets: TicketOrigins): ControlTarget {
  let missing: unknown;
  try {
    const session = findSession(ref);
    return { kind: "session", session, label: session.title };
  } catch (e) {
    missing = e;
  }
  const key = issueKeyFrom(ref);
  if (tickets[key] || useBoardStore.getState().runningAgents.has(key)) {
    return { kind: "ticket", key, label: key };
  }
  // Several sessions with that title is its own answer; otherwise say both looked.
  const why = missing instanceof Error ? missing.message : "";
  if (why.startsWith("Several")) throw missing;
  throw new Error(
    `No session or ticket agent "${ref}". list_sessions shows sessions; a ticket's agent is named by its key.`
  );
}

/** Every ticket's creator, read fresh: a ticket started a moment ago counts. */
export function loadTicketOrigins(): Promise<TicketOrigins> {
  return issueOrigins().catch(() => ({}));
}

/** Whether `caller` started `target`, or started what started it. */
export function callerStarted(
  target: ControlTarget,
  caller: string,
  tickets: TicketOrigins
): boolean {
  const sessions = useSessionsStore.getState().sessions;
  return target.kind === "session"
    ? startedByCaller(target.session, caller, sessions, tickets)
    : ticketStartedByCaller(target.key, caller, sessions, tickets);
}

/** The target's agents that are running: a session's own and its companions', or the ticket's. */
export function runningAgentsOf(target: ControlTarget): string[] {
  const running = useBoardStore.getState().runningAgents;
  const ids =
    target.kind === "session"
      ? [target.session.id, ...(target.session.agents ?? []).map((a) => a.id)]
      : [target.key];
  return ids.filter((id) => running.has(id));
}
