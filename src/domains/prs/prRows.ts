import { dedupePrs } from "../board/prDedupe.ts";
import type { Assignee, Issue, PullRequest } from "../issues/types.ts";

// The Pull requests page's rows, from every source trace knows: the PRs Jira's dev
// panel links to the loaded board's tickets, and the PRs sessions and ticket workspaces
// raised (the PR watcher, `watchStore`, and the sessions overview's `gh` lookup). Pure,
// so the merge is tested on its own (`prRows.test.ts`).

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
  owner: PrOwner;
}

/** A PR a workspace raised: from the watcher's fetch, or the overview's bare reference. */
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
}

/**
 * Every PR once, by URL. Jira's come first, so a PR it links keeps its ticket as owner;
 * the state is the most final any source reported (`dedupePrs`: a PR goes open → merged,
 * never back, so a stale "open" never shadows a fresh "merged"); the title, branch and
 * author are the first source's that knew them.
 */
export function mergePrRows(jira: [PullRequest, Issue][], workspace: WorkspacePr[]): PrRow[] {
  const entries: [PullRequest, Facts][] = [
    ...jira.map(([pr, issue]): [PullRequest, Facts] => [
      pr,
      {
        branch: null,
        author: null,
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
      { branch: w.branch ?? null, author: w.author ?? null, owner: w.owner },
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
    }
  }
  return dedupePrs(entries).flatMap(([pr]) => {
    const known = first.get(pr.url);
    if (!known) return [];
    const { branch, author, owner } = known.facts;
    return [
      {
        url: pr.url,
        number: pr.number,
        state: pr.state,
        title: known.title,
        branch,
        author,
        owner,
      },
    ];
  });
}
