import { activity } from "@/domains/activity/store";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, IssueComment } from "@/domains/issues/types";
import { type AgentCli, type AgentProvider, startAgent } from "@/ipc/agent";
import { listIssueComments } from "@/ipc/issues";
import {
  agentArgs,
  agentCli,
  agentModel,
  agentProvider,
  kickoffPromptTemplate,
  setAgentCli,
  setAgentProvider,
} from "./defaults";
import { agentLabel } from "./providerLabel";
import { fitTerminal, resetTerminal } from "./terminalRegistry";

const MAX_DESCRIPTION_CHARS = 2000;
const MAX_COMMENTS_CHARS = 3000;

/** Format the issue's thread as a compact transcript, keeping the newest
 * messages when the cap forces a cut (the brief's value is recent context). */
function formatComments(comments: IssueComment[]): string {
  if (comments.length === 0) return "(no comments yet)";
  const lines = comments.map((c) => {
    const when = c.created ? `${c.created.slice(0, 16).replace("T", " ")} ` : "";
    const tag = c.isInternal ? " [internal]" : "";
    return `— ${when}${c.author}${tag}: ${c.body}`;
  });
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > MAX_COMMENTS_CHARS) break;
    kept.unshift(lines[i]);
  }
  if (kept.length === 0) {
    // A single message bigger than the cap — keep its tail rather than nothing.
    return `…(truncated)\n${lines[lines.length - 1].slice(0, MAX_COMMENTS_CHARS)}`;
  }
  const omitted = lines.length - kept.length;
  const header = omitted > 0 ? `…(${omitted} earlier message(s) omitted)\n` : "";
  return header + kept.join("\n");
}

/** Best-effort thread fetch: a failure degrades to a placeholder line — it
 * must never block an agent launch. */
async function fetchComments(issue: Issue): Promise<string> {
  const provider = useBoardStore.getState().provider;
  if (!provider) return "(comments unavailable: no board loaded)";
  try {
    return formatComments(await listIssueComments(provider, issue.id));
  } catch (err) {
    return `(comments unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }
}

/** The board-kickoff brief for an issue, from the configurable template.
 * `{comments}` pulls the tracker's discussion thread at launch; when the
 * template doesn't use it, no fetch happens at all. */
export async function kickoffPrompt(issue: Issue): Promise<string> {
  const description = (issue.description ?? "").slice(0, MAX_DESCRIPTION_CHARS) || "(none)";
  const template = kickoffPromptTemplate();
  const comments = template.includes("{comments}") ? await fetchComments(issue) : "";
  return template
    .replace(/\{key\}/g, issue.key)
    .replace(/\{summary\}/g, issue.summary)
    .replace(/\{description\}/g, description)
    .replace(/\{comments\}/g, comments);
}

interface LaunchOptions {
  cli?: AgentCli;
  /** Model provider for the Claude harness (third-party Anthropic-compatible endpoint). */
  provider?: AgentProvider;
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
  { cli, provider, prompt }: LaunchOptions = {}
): Promise<void> {
  const { clearOutput, setAgentRunning, data } = useBoardStore.getState();
  const chosen = cli ?? agentCli();
  // The provider only applies to the Claude harness (codex ignores it).
  const chosenProvider = chosen === "claude" ? (provider ?? agentProvider()) : undefined;
  if (cli) setAgentCli(cli);
  if (provider) setAgentProvider(provider);
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
    matchText,
    chosenProvider
  );
  setAgentRunning(issueKey, true);
  activity.log({
    kind: "agent-start",
    issueKey,
    title: `started ${agentLabel(chosen, chosenProvider)}`,
  });
}
