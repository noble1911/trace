import { useBoardStore } from "@/domains/board/store";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import { issueKeyFrom } from "./boardLookup";

// The orchestrator's agent tools name an agent by `issue_key`. A ticket's agent
// is keyed by its issue key; a standalone session's by the session id (or a
// companion's own id) — which, unlike an issue key, is case-sensitive. So match
// a session id first, then a ticket's key, then a session's title.

export interface AgentKey {
  /** The workspace id the agent runs under. */
  key: string;
  /** How to name it back to the model and on a confirm card. */
  label: string;
}

/** Resolve what the model passed as `issue_key` to an agent's workspace id. */
export function resolveAgentKey(raw: string): AgentKey {
  const wanted = raw.trim();
  const lower = wanted.toLowerCase();
  const sessions = useSessionsStore.getState().sessions.filter((s) => !s.archivedAt);
  const named = (title: string, entry: { label: string; companion: boolean }) =>
    entry.companion ? `session "${title}" · ${entry.label}` : `session "${title}"`;

  for (const session of sessions) {
    const hit = agentRoster(session).find((r) => r.workspaceId.toLowerCase() === lower);
    if (hit) return { key: hit.workspaceId, label: named(session.title, hit) };
  }
  const issueKey = issueKeyFrom(wanted);
  if (useBoardStore.getState().runningAgents.has(issueKey)) {
    return { key: issueKey, label: issueKey };
  }
  for (const session of sessions) {
    if (session.title.trim().toLowerCase() !== lower) continue;
    const primary = agentRoster(session)[0];
    return { key: primary.workspaceId, label: named(session.title, primary) };
  }
  return { key: issueKey, label: issueKey };
}
