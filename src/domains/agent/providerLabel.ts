import type { AgentCli, AgentProvider } from "@/ipc/agent";

/**
 * Display name for a launched agent. A third-party-backed claude reads as the
 * model it actually runs so mixed rosters stay distinguishable.
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
    case "deepseek":
      return "deepseek · flash";
    case "deepseek-pro":
      return "deepseek · pro";
    default:
      return cli;
  }
}
