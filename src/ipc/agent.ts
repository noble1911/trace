import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around the agent/PTY Tauri commands.

export function agentRunning(issueKey: string): Promise<boolean> {
  return invoke("agent_running", { issueKey });
}

export type AgentCli = "claude" | "codex";

export function startAgent(
  issueKey: string,
  cols: number,
  rows: number,
  model?: string,
  cli?: AgentCli,
  extraArgs?: string[]
): Promise<void> {
  return invoke("start_agent", {
    issueKey,
    cols,
    rows,
    model: model ?? null,
    cli: cli ?? "claude",
    extraArgs: extraArgs ?? null,
  });
}

/** Start a plain shell in the issue's worktree (the Terminal tab). */
export function startTerminal(issueKey: string, cols: number, rows: number): Promise<void> {
  return invoke("start_terminal", { issueKey, cols, rows });
}

export function sendAgentInput(issueKey: string, data: string): Promise<void> {
  return invoke("send_agent_input", { issueKey, data });
}

export function resizeAgent(issueKey: string, cols: number, rows: number): Promise<void> {
  return invoke("resize_agent", { issueKey, cols, rows });
}

/** A workspace's rolling output history + the PTY size it was painted at. */
export interface PtySnapshot {
  chunks: string[];
  /** Highest seq included — live chunks at or below this are already here. */
  seq: number;
  cols: number;
  rows: number;
}

/** The backend's output history for replaying a freshly-created terminal. */
export function ptySnapshot(workspaceId: string): Promise<PtySnapshot | null> {
  return invoke("pty_snapshot", { workspaceId });
}

export function stopAgent(issueKey: string): Promise<void> {
  return invoke("stop_agent", { issueKey });
}

/**
 * Forget the saved Claude conversation id for a workspace so the next start
 * begins a brand-new conversation. Use to recover when a stored session id has
 * gone stale (Claude prints "session not found" on `--resume`).
 */
export function resetAgentSession(issueKey: string): Promise<void> {
  return invoke("reset_agent_session", { issueKey });
}
