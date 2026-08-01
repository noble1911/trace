import type { AgentCli, AgentProvider } from "@/ipc/agent";

/**
 * Display name for a launched agent. A third-party-backed claude reads as the
 * model it actually runs ("kimi") so mixed rosters stay distinguishable —
 * Moonshot and Wafer (normal/fast) each get a label.
 */
export function agentLabel(cli: AgentCli, provider?: AgentProvider | null): string {
  if (cli !== "claude") return cli;
  switch (provider) {
    case "moonshot":
      return "kimi";
    case "wafer":
      return "kimi · wafer";
    case "wafer-fast":
      return "kimi · wafer fast";
    default:
      return cli;
  }
}
