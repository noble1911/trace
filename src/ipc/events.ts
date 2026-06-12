import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Typed wrappers around backend events. The PTY pump emits raw bytes per issue.

export interface PtyOutput {
  workspaceId: string;
  /** Base64-encoded raw PTY bytes. */
  data: string;
  /** Monotonic chunk counter matching the backend output history. */
  seq: number;
}

export interface AgentRunState {
  workspaceId: string;
  running: boolean;
}

export function onPtyOutput(cb: (payload: PtyOutput) => void): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (e) => cb(e.payload));
}

export function onAgentRunState(cb: (payload: AgentRunState) => void): Promise<UnlistenFn> {
  return listen<AgentRunState>("agent-run-state", (e) => cb(e.payload));
}
