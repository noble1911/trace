// Agent launch defaults configured in Settings, read from localStorage so the
// start flows and the Settings UI share one source of truth.

import type { AgentCli } from "@/ipc/agent";

const CLI_KEY = "trace.agentCli";
const MODEL_KEY = "trace.agentModel";
const ARGS_KEY = "trace.agentArgs";
const NOTIFY_WAITING_KEY = "trace.notifyOnWaiting";

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in sandboxed contexts — keep the
    // in-memory value and silently skip persistence.
  }
}

/** The agent CLI to launch, shared by board agents and exploratory sessions. */
export function agentCli(): AgentCli {
  return read(CLI_KEY) === "codex" ? "codex" : "claude";
}

export function setAgentCli(next: AgentCli) {
  write(CLI_KEY, next);
}

/** The default model, or undefined to use the CLI's own default. */
export function agentModel(): string | undefined {
  return read(MODEL_KEY).trim() || undefined;
}

/** The model setting as typed, for the Settings input. */
export function agentModelRaw(): string {
  return read(MODEL_KEY);
}

export function setAgentModel(next: string) {
  write(MODEL_KEY, next.trim());
}

/** Extra CLI flags, split on whitespace (e.g. --dangerously-skip-permissions). */
export function agentArgs(): string[] {
  const raw = read(ARGS_KEY).trim();
  return raw ? raw.split(/\s+/) : [];
}

const KICKOFF_KEY = "trace.kickoffPrompt";

/** Default brief sent when an agent is started straight from the board. */
export const DEFAULT_KICKOFF_PROMPT =
  "Work on Jira ticket {key}: {summary}\n\nTicket description:\n{description}\n\n" +
  "Please implement this ticket. Ask if anything is ambiguous.";

/** The kickoff template as typed ("" = default), for the Settings input. */
export function kickoffPromptRaw(): string {
  return read(KICKOFF_KEY);
}

/** The effective kickoff template ({key}/{summary}/{description} placeholders). */
export function kickoffPromptTemplate(): string {
  return read(KICKOFF_KEY).trim() || DEFAULT_KICKOFF_PROMPT;
}

export function setKickoffPrompt(next: string) {
  write(KICKOFF_KEY, next.trim());
}

const AUTO_START_KEY = "trace.autoStartOnMove";

/** Whether dragging a card to In Progress auto-starts its agent. Default off
 * — automation that spawns agents (and spends tokens) should be opted into. */
export function autoStartOnMove(): boolean {
  return read(AUTO_START_KEY) === "1";
}

export function setAutoStartOnMove(on: boolean) {
  write(AUTO_START_KEY, on ? "1" : "");
}

/** Whether a working→waiting flip fires a native notification. Default on. */
export function notifyOnWaiting(): boolean {
  return read(NOTIFY_WAITING_KEY) !== "0";
}

export function setNotifyOnWaiting(on: boolean) {
  // On is the default — store nothing rather than a redundant "1".
  write(NOTIFY_WAITING_KEY, on ? "" : "0");
}

/** The extra-args setting as typed, for the Settings input. */
export function agentArgsRaw(): string {
  return read(ARGS_KEY);
}

export function setAgentArgs(next: string) {
  write(ARGS_KEY, next.trim());
}
