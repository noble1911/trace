import { activity } from "@/domains/activity/store";
import { useBoardStore } from "@/domains/board/store";
import { type AgentCli, startAgent } from "@/ipc/agent";
import { agentArgs, agentCli, agentModel, setAgentCli } from "./defaults";
import { fitTerminal, resetTerminal } from "./terminalRegistry";

/**
 * Start an issue's agent: fit/clear the live terminal, spawn the PTY with the
 * configured defaults, and mark it running. Shared by the detail view's Start
 * button and the board's drag-to-in-progress auto-start. The backend resolves
 * the repo (saved assignment, or the sole configured repo) and is idempotent
 * if a session is already live.
 */
export async function launchIssueAgent(issueKey: string, cli?: AgentCli): Promise<void> {
  const { clearOutput, setAgentRunning } = useBoardStore.getState();
  const chosen = cli ?? agentCli();
  if (cli) setAgentCli(cli);
  // Spawn at the live terminal's measured size when it's mounted (detail view);
  // from the board there's no terminal yet, so 80x24 — the first mount's
  // fit-and-resize repaints the TUI at the real size.
  const size = fitTerminal(issueKey) ?? { cols: 80, rows: 24 };
  clearOutput(issueKey);
  resetTerminal(issueKey);
  await startAgent(issueKey, size.cols, size.rows, agentModel(), chosen, agentArgs());
  setAgentRunning(issueKey, true);
  activity.log({ kind: "agent-start", issueKey, title: `started ${chosen}` });
}
