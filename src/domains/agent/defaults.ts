// Agent launch defaults configured in Settings, read from localStorage so the
// start flows and the Settings UI share one source of truth.

import type { AgentCli } from "@/ipc/agent";

const CLI_KEY = "trace.agentCli";
const MODEL_KEY = "trace.agentModel";
const ARGS_KEY = "trace.agentArgs";

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

/** The extra-args setting as typed, for the Settings input. */
export function agentArgsRaw(): string {
  return read(ARGS_KEY);
}

export function setAgentArgs(next: string) {
  write(ARGS_KEY, next.trim());
}
