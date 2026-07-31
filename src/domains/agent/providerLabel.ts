import type { AgentCli, AgentProvider } from "@/ipc/agent";

/**
 * Display name for a launched agent. A third-party-backed claude reads as the
 * model it actually runs ("kimi") so mixed rosters stay distinguishable —
 * Moonshot direct vs. Fireworks' fast tier get distinct labels.
 */
export function agentLabel(cli: AgentCli, provider?: AgentProvider | null): string {
  if (cli !== "claude") return cli;
  if (provider === "moonshot") return "kimi";
  if (provider === "fireworks") return "kimi · fw";
  return cli;
}
