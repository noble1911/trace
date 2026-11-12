import { toast } from "@/app/toast";
import { activity } from "@/domains/activity/store";
import type { ActivityActor } from "@/domains/activity/types";
import { syncChatActivity } from "@/domains/agentChat/liveBridge";
import { noteTransport, resolveTransport } from "@/domains/agentChat/transport";
import { rememberIssues } from "@/domains/board/issueBoards";
import { useBoardStore } from "@/domains/board/store";
import { type Issue, trackerForIssueKey } from "@/domains/issues/types";
import { TRACKER_NAMES } from "@/domains/sidebar/items";
import { useVercelStore } from "@/domains/vercel/store";
import {
  type AgentCli,
  type AgentProvider,
  type RunsOn,
  startAgent,
  type Transport,
} from "@/ipc/agent";
import { listIssueComments } from "@/ipc/issues";
import {
  agentArgs,
  agentCli,
  agentHost,
  agentModel,
  agentProvider,
  kickoffPromptTemplate,
  setAgentCli,
  setAgentProvider,
} from "./defaults";
import { fillKickoffTemplate, formatComments } from "./kickoffBrief";
import { agentLabel } from "./providerLabel";
import { fitTerminal, resetTerminal, syncPtySize } from "./terminalRegistry";

const MAX_DESCRIPTION_CHARS = 2000;

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
  return fillKickoffTemplate(template, {
    tracker: TRACKER_NAMES[trackerForIssueKey(issue.key)],
    key: issue.key,
    summary: issue.summary,
    description,
    comments,
  });
}

interface LaunchOptions {
  cli?: AgentCli;
  /** Model provider for the Claude harness (third-party Anthropic-compatible endpoint). */
  provider?: AgentProvider;
  /** Sent as the first message (a terminal's positional prompt) — fresh conversations only. */
  prompt?: string;
  /** Chat or terminal for this start; unset keeps the ticket's last, else Settings' default. */
  transport?: Transport;
  /** Where it runs; unset takes Settings' default, else where the ticket ran last. */
  host?: RunsOn;
  /** Who started it, for the activity log (default: the user). */
  actor?: ActivityActor;
}

/**
 * Start an issue's agent: fit/clear the live terminal, spawn the PTY (or the
 * chat agent) with the configured defaults, and mark it running. Shared by the
 * detail view's Start button and the board's kickoff paths (the orchestrator's
 * `start_agent` among them). The backend resolves the repo (saved assignment, or
 * the sole configured repo) and is idempotent if a session is already live.
 */
export async function launchIssueAgent(
  issueKey: string,
  { cli, provider, prompt, actor, transport, host }: LaunchOptions = {}
): Promise<void> {
  const { clearOutput, setAgentRunning, data, boardKey } = useBoardStore.getState();
  const chosen = cli ?? agentCli();
  // The provider only applies to the Claude harness (codex ignores it).
  const chosenProvider = chosen === "claude" ? (provider ?? agentProvider()) : undefined;
  if (cli) setAgentCli(cli);
  if (provider) setAgentProvider(provider);
  // The ticket's summary + labels let repo mappings match a tag like "[BE]" that
  // lives in the title, not the key (the backend pins the resolved repo).
  const issue = data?.issues.find((i) => i.key === issueKey);
  // So its ticket can be found again from Inbox or Fleet once another board is showing.
  if (issue && boardKey) rememberIssues(boardKey, [issue]);
  const matchText = issue ? `${issue.summary} ${issue.labels.join(" ")}` : "";
  // Spawn at the live terminal's measured size when it's mounted (detail view);
  // from the board there's no terminal yet, so 80x24 — the first mount's
  // fit-and-resize repaints the TUI at the real size.
  const size = fitTerminal(issueKey) ?? { cols: 80, rows: 24 };
  const chosenTransport = await resolveTransport(issueKey, chosen, transport);
  if (chosenTransport === "terminal") {
    clearOutput(issueKey);
    resetTerminal(issueKey);
  }
  // Settings' default only reaches a start nobody chose a host for, and only when it
  // can work: Vercel connected and Claude. If it can't (say the repo isn't on GitHub),
  // the ticket starts here instead, with a note.
  const byDefault =
    !host && agentHost() === "vercel" && chosen === "claude" && useVercelStore.getState().status;
  const begin = (runsOn: RunsOn | undefined) =>
    startAgent(
      issueKey,
      size.cols,
      size.rows,
      agentModel(),
      chosen,
      agentArgs(),
      prompt,
      matchText,
      chosenProvider,
      chosenTransport,
      runsOn
    );
  if (byDefault) {
    await begin("vercel").catch((err) => {
      // No repo yet is the same answer here: the board's repo picker handles it.
      if (!String(err).includes("No repository assigned")) {
        toast.error(`Couldn't start in the cloud, starting here instead: ${String(err)}`);
      }
      return begin("local");
    });
  } else {
    await begin(host);
  }
  noteTransport(issueKey, chosenTransport);
  setAgentRunning(issueKey, true);
  if (chosenTransport === "chat") syncChatActivity(issueKey);
  // The pane may have resized while the spawn was in flight.
  else syncPtySize(issueKey);
  activity.log({
    kind: "agent-start",
    actor,
    issueKey,
    title: `started ${agentLabel(chosen, chosenProvider)}`,
  });
}
