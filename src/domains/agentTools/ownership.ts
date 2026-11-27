import type { CreatedBy, ScratchSession } from "@/domains/sessions/types";
import { runIdOf } from "../schedules/ids.ts";

// Which sessions and tickets' agents an agent may stop, interrupt or remove: the
// ones it started, and theirs in turn, judged by each one's recorded creator (a
// session's `createdBy`, a ticket's `issue-origins.json` entry), written by trace
// from the starting agent's own `X-Trace-Workspace` header, never from a tool
// argument. Pure (relative `.ts` imports) so `npm test` can load it.

/** Longest creator chain walked; deeper (or a loop) counts as not started by the caller. */
const MAX_DEPTH = 32;

/** What a calling workspace id stands for, the way `createdBy` records it. */
export type CallerRef =
  | { kind: "session"; id: string }
  | { kind: "ticket"; id: string }
  | { kind: "schedule"; runId: string };

/** The calling agent as `createdBy` names it: its session (a companion counts as its session), its run, or its ticket. */
export function callerRef(caller: string, sessions: ScratchSession[]): CallerRef | null {
  if (!caller) return null;
  const runId = runIdOf(caller);
  if (runId) return { kind: "schedule", runId };
  const owner = sessions.find((s) => s.id === caller || s.agents?.some((a) => a.id === caller));
  return owner ? { kind: "session", id: owner.id } : { kind: "ticket", id: caller };
}

/** Whether `cb` names `ref` as the creator. */
function names(cb: CreatedBy | null | undefined, ref: CallerRef): boolean {
  if (!cb) return false;
  if (cb.kind === "agent") {
    if (ref.kind === "session") return cb.parent === "session" && cb.workspaceId === ref.id;
    if (ref.kind === "ticket") return cb.parent === "ticket" && cb.workspaceId === ref.id;
    return false;
  }
  return cb.kind === "schedule" && ref.kind === "schedule" && cb.runId === ref.runId;
}

/** Who started each ticket's agent, by issue key (`issue-origins.json`); none = the user. */
export type TicketOrigins = Record<string, CreatedBy>;

/**
 * Whether the chain of creators from `first` up reaches `ref`. A session or ticket
 * that was itself started by an agent is followed up to whoever started that; the
 * user, the orchestrator, another computer or a loop ends it.
 */
function chainReaches(
  first: CreatedBy | null | undefined,
  ref: CallerRef,
  sessions: ScratchSession[],
  tickets: TicketOrigins
): boolean {
  const seen = new Set<string>();
  let cb = first;
  for (let depth = 0; cb && depth < MAX_DEPTH; depth++) {
    if (names(cb, ref)) return true;
    if (cb.kind !== "agent") return false;
    const node = `${cb.parent}:${cb.workspaceId}`;
    if (seen.has(node)) return false;
    seen.add(node);
    const parentId = cb.workspaceId;
    cb =
      cb.parent === "session"
        ? sessions.find((s) => s.id === parentId)?.createdBy
        : tickets[parentId];
  }
  return false;
}

/**
 * Whether the agent `caller` started `target`, directly or through sessions or
 * tickets it started. A session never counts as its own descendant, and anything
 * the user, the orchestrator or another agent started is not the caller's.
 */
export function startedByCaller(
  target: ScratchSession,
  caller: string,
  sessions: ScratchSession[],
  tickets: TicketOrigins = {}
): boolean {
  const ref = callerRef(caller, sessions);
  if (!ref) return false;
  if (ref.kind === "session" && ref.id === target.id) return false;
  return chainReaches(target.createdBy, ref, sessions, tickets);
}

/** The same for a ticket's agent: started by the caller, or by what the caller started. */
export function ticketStartedByCaller(
  issueKey: string,
  caller: string,
  sessions: ScratchSession[],
  tickets: TicketOrigins
): boolean {
  const ref = callerRef(caller, sessions);
  if (!ref) return false;
  if (ref.kind === "ticket" && ref.id === issueKey) return false;
  return chainReaches(tickets[issueKey], ref, sessions, tickets);
}

/** The refusal an agent gets for a session it didn't start. */
export function notYours(title: string, action: "stop" | "interrupt" | "remove"): string {
  return `Refused: "${title}" wasn't started by you (or by a session or ticket you started), so you can't ${action} it. The user can ${action} it from trace.`;
}
