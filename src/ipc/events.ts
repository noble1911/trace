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

export interface RichHtml {
  /** The owning issue/workspace key — matches the rich-output store keying. */
  issueKey: string;
  /** Raw HTML from the agent's `trace-render`; rendered in a sandboxed iframe. */
  html: string;
}

export function onPtyOutput(cb: (payload: PtyOutput) => void): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (e) => cb(e.payload));
}

export function onAgentRunState(cb: (payload: AgentRunState) => void): Promise<UnlistenFn> {
  return listen<AgentRunState>("agent-run-state", (e) => cb(e.payload));
}

export function onRichHtml(cb: (payload: RichHtml) => void): Promise<UnlistenFn> {
  return listen<RichHtml>("rich-html", (e) => cb(e.payload));
}
