import { activity } from "@/domains/activity/store";
import { useBoardStore } from "@/domains/board/store";
import type { Issue } from "@/domains/jira/types";
import { type AgentCli, startAgent } from "@/ipc/agent";
import { agentArgs, agentCli, agentModel, kickoffPromptTemplate, setAgentCli } from "./defaults";
import { fitTerminal, resetTerminal } from "./terminalRegistry";

const MAX_DESCRIPTION_CHARS = 2000;

/** The board-kickoff brief for an issue, from the configurable template. */
export function kickoffPrompt(issue: Issue): string {
  const description = (issue.description ?? "").slice(0, MAX_DESCRIPTION_CHARS) || "(none)";
  return kickoffPromptTemplate()
    .replace(/\{key\}/g, issue.key)
    .replace(/\{summary\}/g, issue.summary)
    .replace(/\{description\}/g, description);
}

interface LaunchOptions {
  cli?: AgentCli;
  /** Sent as the CLI's positional prompt — fresh conversations only. */
  prompt?: string;
}

/**
 * Start an issue's agent: fit/clear the live terminal, spawn the PTY with the
 * configured defaults, and mark it running. Shared by the detail view's Start
 * button and the board's kickoff paths. The backend resolves the repo (saved
 * assignment, or the sole configured repo) and is idempotent if a session is
 * already live.
 */
export async function launchIssueAgent(
  issueKey: string,
  { cli, prompt }: LaunchOptions = {}
): Promise<void> {
  const { clearOutput, setAgentRunning, data } = useBoardStore.getState();
  const chosen = cli ?? agentCli();
  if (cli) setAgentCli(cli);
  // The ticket's summary + labels let repo mappings match a tag like "[BE]" that
  // lives in the title, not the key (the backend pins the resolved repo).
  const issue = data?.issues.find((i) => i.key === issueKey);
  const matchText = issue ? `${issue.summary} ${issue.labels.join(" ")}` : "";
  // Spawn at the live terminal's measured size when it's mounted (detail view);
  // from the board there's no terminal yet, so 80x24 — the first mount's
  // fit-and-resize repaints the TUI at the real size.
  const size = fitTerminal(issueKey) ?? { cols: 80, rows: 24 };
  clearOutput(issueKey);
  resetTerminal(issueKey);
  await startAgent(
    issueKey,
    size.cols,
    size.rows,
    agentModel(),
    chosen,
    agentArgs(),
    prompt,
    matchText
  );
  setAgentRunning(issueKey, true);
  activity.log({ kind: "agent-start", issueKey, title: `started ${chosen}` });
}
