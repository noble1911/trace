import { useEffect } from "react";
import { useIssueOrigins } from "@/domains/agent/originStore";
import type { LiveEntry } from "@/domains/live/entries";
import { creatorOf } from "@/domains/sessions/createdBy";
import { useSessionsStore } from "@/domains/sessions/store";
import type { CreatedBy } from "@/domains/sessions/types";
import { type TicketStatus, useTicketStatuses } from "./ticketStatus";

/** Re-read the tickets' statuses when the window comes back, at most this often. */
const FOCUS_GAP_MS = 60_000;

interface FleetFacts {
  /** Who started an agent, when it wasn't you. */
  creatorOf: (e: LiveEntry) => CreatedBy | null;
  /** A ticket's status in its tracker, once read. */
  statusOf: (e: LiveEntry) => TicketStatus | null;
}

// What Fleet says about each agent beyond its live state: who started it (a ticket's
// record from `originStore`, a session's own `createdBy`) and a ticket's status in
// its tracker, re-read when the running tickets change and when you come back.
export function useFleetFacts(entries: LiveEntry[]): FleetFacts {
  const origins = useIssueOrigins((s) => s.origins);
  const statuses = useTicketStatuses((s) => s.statuses);
  const sessions = useSessionsStore((s) => s.sessions);
  const ticketKeys = entries
    .filter((e) => e.source === "ticket")
    .map((e) => e.id)
    .sort()
    .join("\n");

  useEffect(() => {
    void useIssueOrigins.getState().load();
  }, []);

  useEffect(() => {
    const keys = ticketKeys ? ticketKeys.split("\n") : [];
    const refresh = () => void useTicketStatuses.getState().refresh(keys);
    refresh();
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < FOCUS_GAP_MS) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ticketKeys]);

  return {
    creatorOf: (e) => {
      if (e.source === "ticket") return origins[e.id] ?? null;
      const session = sessions.find((s) => s.id === e.worktreeId);
      const by = session ? creatorOf(session) : null;
      return by && by.kind !== "user" ? by : null;
    },
    statusOf: (e) => (e.source === "ticket" ? (statuses[e.id] ?? null) : null),
  };
}
