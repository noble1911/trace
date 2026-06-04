import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around the agent/PTY Tauri commands.

export function setRepoPath(path: string): Promise<void> {
  return invoke("set_repo_path", { path });
}

export function getRepoPath(): Promise<string | null> {
  return invoke("get_repo_path");
}

export function agentRunning(issueKey: string): Promise<boolean> {
  return invoke("agent_running", { issueKey });
}

export type AgentCli = "claude" | "codex";

export function startAgent(
  issueKey: string,
  cols: number,
  rows: number,
  model?: string,
  cli?: AgentCli
): Promise<void> {
  return invoke("start_agent", {
    issueKey,
    cols,
    rows,
    model: model ?? null,
    cli: cli ?? "claude",
  });
}

export function sendAgentInput(issueKey: string, data: string): Promise<void> {
  return invoke("send_agent_input", { issueKey, data });
}

export function resizeAgent(issueKey: string, cols: number, rows: number): Promise<void> {
  return invoke("resize_agent", { issueKey, cols, rows });
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
