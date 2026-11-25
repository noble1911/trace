import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActivityEvent } from "@/domains/activity/types";
import type { RunStatus } from "@/domains/schedules/types";
import type { ScratchSession } from "@/domains/sessions/types";

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
  /** On a stop: the process ended by itself (quit or crashed), not by a Stop. */
  exited?: boolean;
}

/**
 * A Claude agent's turn event, from its Stop/Notification hooks (`claude::hooks`).
 * Codex agents have no hooks and never send these.
 */
export interface AgentTurn {
  workspaceId: string;
  /** "stop": a turn ended. "needsInput": Claude is blocked on the user (e.g. a permission prompt). */
  event: "stop" | "needsInput";
  /** Background agents/shells/workflows still pending when the turn ended; 0 for needsInput. */
  backgroundTasks: number;
  /** needsInput: Claude Code's notification type (`permission_prompt`, `elicitation_dialog`, …). */
  notificationType?: string | null;
  /** needsInput: the notification's text, e.g. "Claude needs your permission to use Bash". */
  message?: string | null;
  /** stop: Claude's closing message for the turn (clipped). */
  lastMessage?: string | null;
}

/**
 * What a Claude agent's permission dialog is for, from its PermissionRequest hook
 * (`claude::permission_ask`) — sent just before the dialog shows. A summary only.
 */
export interface AgentAsk {
  workspaceId: string;
  /** `Bash`, `Edit`, `AskUserQuestion`, `ExitPlanMode`, an MCP tool, … */
  tool: string;
  /** The command, path, URL, question or plan it's about. */
  detail: string | null;
  /** AskUserQuestion: the first question's options, in menu order. */
  options: string[];
  multiSelect: boolean;
  /** AskUserQuestion: how many questions it asks. */
  questions: number;
  /** Whether the dialog offers "Yes, and don't ask again". */
  canAlwaysAllow: boolean;
}

/** A scheduled run started, changed (skips, needs input), or finished. */
export interface ScheduleRunEvent {
  promptId: string;
  runId: string;
  status: RunStatus;
  needsInput: boolean;
}

export function onPtyOutput(cb: (payload: PtyOutput) => void): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (e) => cb(e.payload));
}

export function onAgentRunState(cb: (payload: AgentRunState) => void): Promise<UnlistenFn> {
  return listen<AgentRunState>("agent-run-state", (e) => cb(e.payload));
}

export function onScheduleRun(cb: (payload: ScheduleRunEvent) => void): Promise<UnlistenFn> {
  return listen<ScheduleRunEvent>("schedule-run", (e) => cb(e.payload));
}

/** A session this window didn't make: another computer started it here over the peer server. */
export function onSessionAdded(cb: (session: ScratchSession) => void): Promise<UnlistenFn> {
  return listen<ScratchSession>("session-added", (e) => cb(e.payload));
}

/** Prompts changed backend-side (saved, paused, or next-run times advanced). */
export function onSchedulesChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("schedules-changed", () => cb());
}

/** An agent calling one of trace's own tools (`agent_tools`). */
export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
  /** Workspace id of the calling agent (issue key, session id, `sched:` run). */
  caller: string;
}

/** A new prompt reached the agent, so any dialog it had open is over. */
export function onAgentPrompt(cb: (payload: { workspaceId: string }) => void): Promise<UnlistenFn> {
  return listen<{ workspaceId: string }>("agent-prompt", (e) => cb(e.payload));
}

export function onAgentToolCall(cb: (payload: AgentToolCall) => void): Promise<UnlistenFn> {
  return listen<AgentToolCall>("agent-tool-call", (e) => cb(e.payload));
}

export function onAgentTurn(cb: (payload: AgentTurn) => void): Promise<UnlistenFn> {
  return listen<AgentTurn>("agent-turn", (e) => cb(e.payload));
}

export function onAgentAsk(cb: (payload: AgentAsk) => void): Promise<UnlistenFn> {
  return listen<AgentAsk>("agent-ask", (e) => cb(e.payload));
}

/** A question or plan dialog an agent showed has been answered (its tool returned). */
export function onAgentAnswered(
  cb: (payload: { workspaceId: string }) => void
): Promise<UnlistenFn> {
  return listen<{ workspaceId: string }>("agent-answered", (e) => cb(e.payload));
}

/** A new entry on the activity log (`activity::record`), from any producer. */
export function onActivityEvent(cb: (payload: ActivityEvent) => void): Promise<UnlistenFn> {
  return listen<ActivityEvent>("activity-event", (e) => cb(e.payload));
}
