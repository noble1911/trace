import { rememberedIssueTitle } from "@/domains/board/issueBoards";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { useLiveStore } from "@/domains/live/store";
import { runIdOf } from "@/domains/schedules/ids";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import type { ScratchSession } from "@/domains/sessions/types";
import { mergePrRows, type PrOwner, type PrRow, type WorkspacePr } from "../prRows";
import { usePrWatchStore } from "../watchStore";
import { useRaisedPrs } from "./useRaisedPrs";

/** The session a workspace id belongs to: the session's own, or one of its agents'. */
function sessionOf(sessions: ScratchSession[], id: string): ScratchSession | undefined {
  return (
    sessions.find((s) => s.id === id) ??
    sessions.find((s) => agentRoster(s).some((r) => r.workspaceId === id))
  );
}

/**
 * Every pull request trace knows, for the Pull requests page (`prRows`): the ones Jira
 * links to the loaded board's tickets; every one a session or ticket workspace raised
 * (`useRaisedPrs`: its branch's and each its conversation created, in any repo,
 * refreshed every minute while the page is open; every ticket trace ever started, not
 * only live ones); and every PR the watcher found this run (`watchStore`).
 */
export function usePrRows(): PrRow[] {
  const data = useBoardStore((s) => s.data);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const sessions = useSessionsStore((s) => s.sessions);
  const live = useLiveStore((s) => s.info);
  const links = usePrWatchStore((s) => s.links);
  const threads = usePrWatchStore((s) => s.threads);

  const active = sessions.filter((s) => !s.archivedAt);
  // Live agents not in a session (and not scheduled runs) are tickets'.
  const tickets = Object.keys(live).filter((id) => !runIdOf(id) && !sessionOf(sessions, id));
  const raised = useRaisedPrs([...active.map((s) => s.id), ...tickets]);

  const issueOf = (key: string) => data?.issues.find((i) => i.key === key);
  const ownerOf = (id: string): PrOwner | null => {
    if (runIdOf(id)) return null;
    const session = sessionOf(sessions, id);
    if (session) {
      return session.archivedAt ? null : { kind: "session", id: session.id, title: session.title };
    }
    const issue = issueOf(id);
    return {
      kind: "issue",
      key: id,
      summary: issue?.summary ?? rememberedIssueTitle(id) ?? "",
      assignee: issue?.assignee ?? null,
    };
  };

  // The watcher's first: its fetches are live, the backend's list up to a minute old,
  // and `mergePrRows` takes each fact from the first source that has it.
  const workspace: WorkspacePr[] = [];
  for (const [id, urls] of Object.entries(links)) {
    const owner = ownerOf(id);
    if (!owner) continue;
    for (const url of urls) {
      const t = threads[url];
      if (!t) continue;
      workspace.push({
        url,
        number: t.number,
        state: t.state,
        title: t.title,
        branch: t.headRef,
        author: t.author,
        owner,
      });
    }
  }

  for (const pr of raised) {
    const owner = ownerOf(pr.workspaceId);
    if (owner) workspace.push({ ...pr, owner });
  }

  const jira: [PullRequest, Issue][] = [];
  for (const issue of data?.issues ?? []) {
    for (const pr of pullRequests[issue.key] ?? []) jira.push([pr, issue]);
  }
  return mergePrRows(jira, workspace);
}
