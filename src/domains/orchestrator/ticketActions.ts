import { activity } from "@/domains/activity/store";
import type { ActivityActor } from "@/domains/activity/types";
import { str } from "@/domains/agentTools/args";
import { startOfWorkStatus } from "@/domains/board/columns";
import { useBoardStore } from "@/domains/board/store";
import { trackerForIssueKey } from "@/domains/issues/types";
import { commentOnIssue, transitionIssue } from "@/ipc/issues";
import { issueKeyFrom, type LocatedIssue, locateIssue } from "./boardLookup";
import { noColumnMessage, resolveTarget } from "./boardRef";

// move_issue, start_agent and comment_on_issue for a ticket on any board. The ticket's
// board comes from `locateIssue`; the shown board's UI is refreshed after a change, any
// other board is left as it is (there is nothing on screen to update).

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The ticket named by `issue_key` (and optional `board`), or the sentence saying why not. */
async function located(input: unknown): Promise<LocatedIssue | string> {
  const raw = str(input, "issue_key");
  if (!raw) return "Error: missing issue_key.";
  try {
    return await locateIssue(raw, str(input, "board"));
  } catch (e) {
    return reason(e);
  }
}

/** Move a ticket to a column (or status) of its own board. */
export async function moveIssueTool(input: unknown, actor: ActivityActor): Promise<string> {
  const found = await located(input);
  if (typeof found === "string") return found;
  const { key, issue, board } = found;
  const want = str(input, "target_status");
  const target = resolveTarget(board.data.columns, want);
  if (!target) return noColumnMessage(board.data.columns, want);
  if (target.statuses.some((s) => s.id === issue.statusId)) {
    return `${key} is already in ${target.name}.`;
  }
  // Raw transition (not the board's optimistic moveIssue) so the model hears the real
  // outcome; the shown board is then reloaded to match.
  try {
    await transitionIssue(
      board.provider,
      key,
      target.statuses.map((s) => s.id)
    );
    activity.log({ kind: "transition", actor, issueKey: key, title: `→ ${target.name}` });
    if (board.shown) await useBoardStore.getState().refresh();
    return `Moved ${key} to ${target.name}.`;
  } catch (e) {
    return `Couldn't move ${key}: ${reason(e)}`;
  }
}

/** Comment on a ticket. The key alone says which tracker; no board needed. */
export async function commentTool(input: unknown): Promise<string> {
  const key = issueKeyFrom(str(input, "issue_key"));
  if (!key) return "Error: missing issue_key.";
  const body = str(input, "body");
  if (!body) return "Error: empty comment.";
  try {
    await commentOnIssue(trackerForIssueKey(key), key, body);
    return `Commented on ${key}.`;
  } catch (e) {
    return `Couldn't comment on ${key}: ${reason(e)}`;
  }
}

/** Move a ticket to its board's first in-progress column, unless it's in progress: the
 * words to add to the reply. A failed move is said, not thrown: the agent runs anyway. */
async function moveToStartOfWork(
  { key, issue, board }: LocatedIssue,
  actor: ActivityActor
): Promise<string> {
  const target = startOfWorkStatus(board.data.columns);
  if (issue.statusCategory === "indeterminate" || !target) return "";
  try {
    await transitionIssue(board.provider, key, [target.id]);
    activity.log({ kind: "transition", actor, issueKey: key, title: `→ ${target.name}` });
    return ` and moved it to ${target.name}`;
  } catch (e) {
    return ` (couldn't move it: ${reason(e)})`;
  }
}

/** Begin work on a ticket: start its agent and move it to In Progress (unless it is). */
export async function startAgentTool(input: unknown, actor: ActivityActor): Promise<string> {
  const found = await located(input);
  if (typeof found === "string") return found;
  const { key, issue, board } = found;
  const store = useBoardStore.getState();
  if (store.runningAgents.has(key)) return `An agent is already running on ${key}.`;
  const done = (moved: string) =>
    `Started an agent on ${key}${moved}. It's been handed the kickoff brief and is working: no follow-up message is needed.`;

  if (board.shown) {
    // The board's own kickoff (it asks for a repo on the board when it needs one).
    const moved = await moveToStartOfWork(found, actor);
    store.kickoff(key, actor);
    await store.refresh();
    return done(moved);
  }
  // Its board isn't the one on screen, so the store can't kick it off: launch it here,
  // with the ticket and its tracker handed over. A repo that isn't assigned comes back as
  // the error (the repo picker belongs to the shown board). The card moves only once the
  // agent has started, so a failed start leaves it where it was.
  try {
    const { launchIssueAgent, kickoffPrompt } = await import("@/domains/agent/launch");
    const prompt = await kickoffPrompt(issue, board.provider, board.boardKey);
    await launchIssueAgent(key, { prompt, actor, issue, boardKey: board.boardKey });
  } catch (e) {
    return `Couldn't start an agent on ${key}, so its card wasn't moved: ${reason(e)}`;
  }
  return done(await moveToStartOfWork(found, actor));
}
