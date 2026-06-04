import { invoke } from "@tauri-apps/api/core";
import type { ScratchSession } from "@/domains/sessions/types";
import type { AgentCli } from "./agent";

// Typed wrappers around the exploratory-session commands. Start/stop/input/resize
// reuse the agent commands (ipc/agent.ts) keyed by the session id.

export function listSessions(): Promise<ScratchSession[]> {
  return invoke("list_sessions");
}

export function createSession(title: string, cli: AgentCli): Promise<ScratchSession> {
  return invoke("create_session", { title, cli });
}

export function deleteSession(id: string): Promise<void> {
  return invoke("delete_session", { id });
}

export function startSession(id: string, cols: number, rows: number): Promise<void> {
  return invoke("start_session", { id, cols, rows });
}
