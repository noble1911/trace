import { invoke } from "@tauri-apps/api/core";
import type { Transport } from "@/domains/agentChat/types";

export type { Transport };

// Typed wrappers around the agent/PTY Tauri commands.

export function agentRunning(issueKey: string): Promise<boolean> {
  return invoke("agent_running", { issueKey });
}

/** Every live agent's workspace id (PTYs and chat agents): agents, sessions,
 * shells (`term:`), runs (`sched:`). */
export function liveWorkspaces(): Promise<string[]> {
  return invoke("live_workspaces");
}

export type AgentCli = "claude" | "codex";

/**
 * Model provider behind the Claude Code harness. Third-party Anthropic-
 * compatible endpoints (Moonshot, Wafer normal/fast, DeepSeek flash/pro) run
 * the same `claude` CLI with env overrides injected Rust-side; only meaningful
 * with cli === "claude".
 */
export type AgentProvider =
  | "anthropic"
  | "moonshot"
  | "wafer"
  | "wafer-fast"
  | "deepseek"
  | "deepseek-pro";

/** Where a ticket's agent runs: this machine (a worktree), a Vercel sandbox, or a paired
 * peer, `peer:<id>` (the id from `peer_list`). */
export type RunsOn = "local" | "vercel" | `peer:${string}`;

/** Where `issueKey`'s agent runs, as last started. A recorded host is a sandbox unless
 * it says `kind: "peer"`. */
export async function issueHost(issueKey: string): Promise<RunsOn> {
  const host = await invoke<{ kind?: string; peer?: string } | null>("issue_host", { issueKey });
  if (!host) return "local";
  return host.kind === "peer" && host.peer ? `peer:${host.peer}` : "vercel";
}

export function startAgent(
  issueKey: string,
  cols: number,
  rows: number,
  model?: string,
  cli?: AgentCli,
  extraArgs?: string[],
  initialPrompt?: string,
  matchText?: string,
  provider?: AgentProvider,
  /** Unset keeps what the ticket ran on last (the terminal if it never ran). */
  transport?: Transport,
  /** Unset keeps where the ticket ran last (this machine if it never ran). */
  host?: RunsOn,
  /** The ticket's board (`provider:boardId`), whose settings can pick its repo. */
  boardKey?: string
): Promise<void> {
  return invoke("start_agent", {
    issueKey,
    cols,
    rows,
    model: model ?? null,
    cli: cli ?? "claude",
    provider: provider ?? null,
    extraArgs: extraArgs ?? null,
    initialPrompt: initialPrompt ?? null,
    matchText: matchText ?? null,
    transport: transport ?? null,
    host: host ?? null,
    boardKey: boardKey ?? null,
  });
}

/** Start a plain shell in the issue's worktree (the Terminal tab). */
export function startTerminal(issueKey: string, cols: number, rows: number): Promise<void> {
  return invoke("start_terminal", { issueKey, cols, rows });
}

export function sendAgentInput(issueKey: string, data: string): Promise<void> {
  return invoke("send_agent_input", { issueKey, data });
}

/** Resize a PTY; resolves false when there's no PTY (yet) to take it. */
export function resizeAgent(issueKey: string, cols: number, rows: number): Promise<boolean> {
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

/** Stop a workspace's agent, terminal or chat. A chat agent's exit follows shortly. */
/** What an agent's host can do besides its screen (`execution::Capabilities`).
 * Everything on this computer; on a Vercel sandbox, the terminal and the chat only. */
export interface AgentCapabilities {
  turnHooks: boolean;
  transcript: boolean;
  files: boolean;
  terminal: boolean;
  tests: boolean;
  agentTools: boolean;
  /** It can run as a chat as well as in a terminal. */
  chat: boolean;
}

export function agentCapabilities(workspaceId: string): Promise<AgentCapabilities> {
  return invoke("agent_capabilities", { workspaceId });
}

/** Disconnect from an agent on another host (a Vercel sandbox), leaving it running
 * there. Starting it again joins it. Refused for a local agent. */
export function detachAgent(issueKey: string): Promise<void> {
  return invoke("detach_agent", { issueKey });
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
