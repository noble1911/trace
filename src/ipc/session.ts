import { invoke } from "@tauri-apps/api/core";
import type { ScratchSession, SessionGroups } from "@/domains/sessions/types";
import type { AgentCli, AgentProvider } from "./agent";

// Typed wrappers around the exploratory-session commands. Start/stop/input/resize
// reuse the agent commands (ipc/agent.ts) keyed by the session id.

export function listSessions(): Promise<ScratchSession[]> {
  return invoke("list_sessions");
}

export function createSession(
  title: string,
  cli: AgentCli,
  repo?: string | null,
  provider?: AgentProvider
): Promise<ScratchSession> {
  return invoke("create_session", { title, cli, repo: repo ?? null, provider: provider ?? null });
}

export function renameSession(id: string, title: string): Promise<ScratchSession> {
  return invoke("rename_session", { id, title });
}

export function archiveSession(id: string): Promise<void> {
  return invoke("archive_session", { id });
}

export function unarchiveSession(id: string): Promise<void> {
  return invoke("unarchive_session", { id });
}

export function deleteSession(id: string): Promise<void> {
  return invoke("delete_session", { id });
}

/** Bind a session's workspace to a Jira issue; the session is consumed. */
export function linkSessionToIssue(id: string, issueKey: string): Promise<void> {
  return invoke("link_session_to_issue", { id, issueKey });
}

/** Tabs + sections, in display order. */
export function listSessionGroups(): Promise<SessionGroups> {
  return invoke("list_session_groups");
}

/** Replace the whole structure; returns it sanitized (dangling refs cleared). */
export function saveSessionGroups(groups: SessionGroups): Promise<SessionGroups> {
  return invoke("save_session_groups", { groups });
}

/** File a session under a tab and/or section (null = default/unsectioned). */
export function setSessionGroup(
  id: string,
  tab: string | null,
  section: string | null
): Promise<ScratchSession> {
  return invoke("set_session_group", { id, tab, section });
}

export function startSession(
  id: string,
  cols: number,
  rows: number,
  extraArgs?: string[]
): Promise<void> {
  return invoke("start_session", { id, cols, rows, extraArgs: extraArgs ?? null });
}

/**
 * Add a companion agent to a session — a second CLI (or a second instance of the
 * same one) sharing the session's worktree. Returns the updated session.
 */
export function addSessionAgent(
  id: string,
  cli: AgentCli,
  provider?: AgentProvider
): Promise<ScratchSession> {
  return invoke("add_session_agent", { id, cli, provider: provider ?? null });
}

/** Remove a companion agent: its PTY is killed and its conversation forgotten. */
export function removeSessionAgent(id: string, agentId: string): Promise<ScratchSession> {
  return invoke("remove_session_agent", { id, agentId });
}

/** Start (or resume) a companion agent in its session's worktree. */
export function startSessionAgent(
  id: string,
  agentId: string,
  cols: number,
  rows: number,
  extraArgs?: string[]
): Promise<void> {
  return invoke("start_session_agent", { id, agentId, cols, rows, extraArgs: extraArgs ?? null });
}
