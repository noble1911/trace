// The journal: every chat agent's conversation, whatever its brand. Mirrors
// src-tauri/src/agent_session/journal.rs and mod.rs; keep the two in step.
// See docs/AGENT_CHAT.md.

/** One row, upserted by `id`; a higher `revision` replaces a lower one. */
export interface JournalRow {
  id: string;
  revision: number;
  /** Order of first appearance. */
  seq: number;
  /** Unix milliseconds. */
  at: number;
  turnId?: string;
  body: JournalBody;
}

export type JournalBody =
  | ({ kind: "message" } & Message)
  | ({ kind: "tool" } & ToolCall)
  | ({ kind: "diff" } & FileDiff)
  | ({ kind: "plan" } & Plan)
  | ({ kind: "approval" } & Approval)
  | ({ kind: "question" } & QuestionSet)
  | ({ kind: "status" } & Status)
  | ({ kind: "turn" } & Turn);

export type Role = "user" | "assistant" | "reasoning" | "system";

export interface Message {
  role: Role;
  /** Markdown. */
  text: string;
  /** True while text is still arriving. */
  streaming: boolean;
  /** Set when a subagent said it: the call that started that subagent. */
  parentCallId?: string;
  /**
   * A user message's attached files (absolute paths), drawn under its text.
   * Older rows named them in `text` instead.
   */
  attachments?: string[];
}

export type ToolState = "running" | "completed" | "failed";

export interface ToolCall {
  callId: string;
  /** The agent's own tool name ("Bash", "Edit", "shell", …). */
  name: string;
  input: unknown;
  state: ToolState;
  /** Capped result text. */
  output?: string;
  /** Set when a subagent made this call. */
  parentCallId?: string;
  /** Set when this call started a subagent: how that agent is doing. */
  subagent?: Subagent;
}

/** Separate from its call's state: a background subagent's call returns at once. */
export type SubagentState = "running" | "completed" | "failed" | "stopped";

/** `agent_session::subagent::Subagent`. Its own rows name its call as `parentCallId`. */
export interface Subagent {
  /** "Explore", "general-purpose", when the agent names a kind. */
  agentType?: string;
  /** A few words on its job. */
  description?: string;
  /** It outlives the turn that started it. */
  background: boolean;
  state: SubagentState;
  /** What it's doing now, in the agent's words. */
  activity?: string;
  toolUses?: number;
  durationMs?: number;
  /** Its final report, capped. */
  result?: string;
}

export type ChangeKind = "add" | "edit" | "delete";

export interface FileDiff {
  callId?: string;
  path: string;
  /** Named `change`, not `kind`: `kind` is the body's own tag. */
  change: ChangeKind;
  before?: string;
  after?: string;
  patch?: string;
}

export type PlanStatus = "pending" | "inProgress" | "done";

export interface Plan {
  items: { text: string; status: PlanStatus }[];
}

export type ApprovalKind = "allowOnce" | "allowAlways" | "deny";

export interface ApprovalOption {
  id: string;
  label: string;
  kind: ApprovalKind;
}

export type Answer =
  | { kind: "approval"; optionId: string; note?: string }
  /** Per question id: chosen option labels, or typed text. */
  | { kind: "questions"; answers: Record<string, string[]> };

export type Resolution = { state: "answered"; answer: Answer } | { state: "cancelled" };

export interface Approval {
  requestId: string;
  callId?: string;
  tool: string;
  title: string;
  detail?: string;
  options: ApprovalOption[];
  resolution?: Resolution;
}

export interface Question {
  id: string;
  header?: string;
  text: string;
  /** `preview`: what picking it would look like (a snippet, a mock-up). */
  options: { label: string; description?: string; preview?: string }[];
  multiSelect: boolean;
  allowFreeText: boolean;
}

export interface QuestionSet {
  requestId: string;
  questions: Question[];
  resolution?: Resolution;
}

export type Tone = "info" | "warning" | "error";

export interface Status {
  text: string;
  tone: Tone;
}

export type TurnState = "running" | "completed" | "interrupted" | "failed";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
}

export interface Turn {
  turnId: string;
  state: TurnState;
  durationMs?: number;
  usage?: Usage;
}

/** A user turn. */
export interface UserMessage {
  text: string;
  /** Absolute paths of attached files or images. */
  attachments: string[];
}

export interface LimitWindow {
  name: string;
  /** 0–1. */
  utilization: number;
  /** Unix seconds. */
  resetsAt?: number;
}

/** Facts about the running agent that aren't rows. */
export interface SessionInfo {
  agent: string;
  model?: string;
  conversationId?: string;
  slashCommands: string[];
  /** A turn is running. */
  busy: boolean;
  /** Subagents still working, background ones that outlived their turn included. */
  runningSubagents?: number;
  limits: LimitWindow[];
  /** How full the main conversation's context window is; absent before a model call. */
  context?: ContextUsage;
  /** The reasoning effort in effect, when known (the agent's own name for it). */
  effort?: string;
  /** The permission mode in effect (Claude Code's names), when known. */
  permissionMode?: string;
  /** A third-party provider behind the agent, which pins its model. */
  provider?: string;
  /** Work still running that isn't a subagent: background shells, monitors, workflows. */
  background?: BackgroundTask[];
}

/** `agent_session::TaskKind`. */
export type TaskKind = "shell" | "monitor" | "workflow" | "agent" | "other";

/** `agent_session::BackgroundTask`: one task running behind the conversation. */
export interface BackgroundTask {
  taskId: string;
  kind: TaskKind;
  /** A shell's command or description, in the agent's words. */
  description: string;
  /** Unix ms. */
  startedAt: number;
  /** The call that started it, which also names it to stop. */
  callId?: string;
}

/** A workspace's picked agent options (`agent_session::options`); unset = Settings' default. */
export interface AgentOptions {
  model?: string;
  effort?: string;
  permissionMode?: string;
}

/** Tokens in the agent's context window, from its latest model call. */
export interface ContextUsage {
  used: number;
  window: number;
  /** The window is guessed from the model id: the agent hasn't reported it yet. */
  estimated: boolean;
}

/** How an agent is hosted: this chat view, or its TUI in a terminal. */
export type Transport = "chat" | "terminal";

/** `chat_agent_state`: a workspace's chat agent as it is now (`runtime::ChatAgentState`). */
export interface ChatAgentState {
  /** What its agent runs on, once it has run or been chosen. */
  transport: Transport | null;
  /** A chat agent is starting, running or stopping. */
  running: boolean;
  /** What it last reported, if one ran since trace started. */
  info: SessionInfo | null;
}

/** Events the backend emits, one per agent. */
export interface JournalEvent {
  workspaceId: string;
  rows: JournalRow[];
  /** The rows are the whole journal, renumbered: they replace what's held. */
  reset?: boolean;
}

export interface SessionInfoEvent {
  workspaceId: string;
  info: SessionInfo;
}
