import type { AgentCli, AgentProvider } from "@/ipc/agent";

/** One launchable agent: a CLI and (for Claude) the model provider behind it. */
export interface AgentOption {
  cli: AgentCli;
  provider: AgentProvider;
  label: string;
}

/**
 * Every agent trace can launch, in menu order. Shared by the ticket header's
 * split Start button and a session's "+ agent" menu so the two never drift.
 */
export const AGENT_OPTIONS: AgentOption[] = [
  { cli: "claude", provider: "anthropic", label: "Claude" },
  { cli: "claude", provider: "moonshot", label: "Claude · Kimi (Moonshot)" },
  { cli: "claude", provider: "wafer", label: "Claude · Kimi (Wafer)" },
  { cli: "claude", provider: "wafer-fast", label: "Claude · Kimi Fast (Wafer)" },
  { cli: "claude", provider: "deepseek", label: "Claude · DeepSeek Flash" },
  { cli: "claude", provider: "deepseek-pro", label: "Claude · DeepSeek Pro" },
  { cli: "codex", provider: "anthropic", label: "Codex" },
];

/** Whether an option is the current cli+provider pick (codex has no provider). */
export function isChosen(o: AgentOption, cli: AgentCli, provider: AgentProvider): boolean {
  return o.cli === cli && (cli === "codex" || o.provider === provider);
}
