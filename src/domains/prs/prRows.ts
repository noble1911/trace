import { dedupePrs } from "../board/prDedupe.ts";
import type { Assignee, Issue, PullRequest } from "../issues/types.ts";

// The Pull requests page's rows, from every source trace knows: the PRs Jira's dev
// panel links to the loaded board's tickets, and the PRs sessions and ticket workspaces
// raised (the PR watcher, `watchStore`, and the backend's `raised_prs`, `useRaisedPrs`).
// Pure, so the merge is tested on its own (`prRows.test.ts`).

/** What a PR belongs to, and what its row's chip opens. */
export type PrOwner =
  | { kind: "issue"; key: string; summary: string; assignee: Assignee | null }
  | { kind: "session"; id: string; title: string };

export interface PrRow {
  url: string;
  number: string;
  /** As the source reported it: open | draft | merged | closed | declined. */
  state: string;
  /** The PR's own title; blank when no source knew it (the row falls back to its owner's). */
  title: string;
  /** Its head branch, when known. */
  branch: string | null;
  /** Who opened it on GitHub, when known (the watcher's). */
  author: string | null;
  /** What it belongs to: its ticket when Jira links it, else whatever raised it. */
  owner: PrOwner;
  /**
   * The session or ticket workspace in trace that raised it, the way back to the agent
   * that wrote it; null for a PR only Jira knows. Can differ from `owner`: a session can
   * raise a PR that Jira links to a ticket.
   */
  raisedIn: PrOwner | null;
}

/** A PR a workspace raised: from the watcher's fetch, or the backend's `raised_prs` list. */
export interface WorkspacePr {
  url: string;
  number: number | string;
  state: string;
  title?: string | null;
  branch?: string | null;
  author?: string | null;
  owner: PrOwner;
}

interface Facts {
  branch: string | null;
  author: string | null;
  owner: PrOwner;
  raisedIn: PrOwner | null;
}

/**
 * Every PR once, by URL. Jira's come first, so a PR it links keeps its ticket as owner;
 * the state is the most final any source reported (`dedupePrs`: a PR goes open → merged,
 * never back, so a stale "open" never shadows a fresh "merged"); the title, branch,
 * author and the workspace that raised it are the first source's that knew them.
 */
export function mergePrRows(jira: [PullRequest, Issue][], workspace: WorkspacePr[]): PrRow[] {
  const entries: [PullRequest, Facts][] = [
    ...jira.map(([pr, issue]): [PullRequest, Facts] => [
      pr,
      {
        branch: null,
        author: null,
        raisedIn: null,
        owner: {
          kind: "issue",
          key: issue.key,
          summary: issue.summary,
          assignee: issue.assignee ?? null,
        },
      },
    ]),
    ...workspace.map((w): [PullRequest, Facts] => [
      { url: w.url, number: String(w.number), state: w.state, title: w.title ?? "" },
      { branch: w.branch ?? null, author: w.author ?? null, owner: w.owner, raisedIn: w.owner },
    ]),
  ];
  const first = new Map<string, { title: string; facts: Facts }>();
  for (const [pr, facts] of entries) {
    const seen = first.get(pr.url);
    if (!seen) first.set(pr.url, { title: pr.title, facts: { ...facts } });
    else {
      seen.title ||= pr.title;
      seen.facts.branch ??= facts.branch;
      seen.facts.author ??= facts.author;
      seen.facts.raisedIn ??= facts.raisedIn;
    }
  }
  return dedupePrs(entries).flatMap(([pr]) => {
    const known = first.get(pr.url);
    if (!known) return [];
    const { branch, author, owner, raisedIn } = known.facts;
    return [
      {
        url: pr.url,
        number: pr.number,
        state: pr.state,
        title: known.title,
        branch,
        author,
        owner,
        raisedIn,
      },
    ];
  });
}
