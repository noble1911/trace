import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around the PR-watch commands (`commands/pr_watch.rs`): which
// PRs a workspace raised, and each one's live discussion.

export interface PrComment {
  id: string;
  author: string;
  isBot: boolean;
  /** GitHub-flavoured markdown (may carry HTML from bots). */
  body: string;
  url: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp of the last edit; null if never edited. */
  editedAt: string | null;
}

/** One item in a PR's conversation. */
export interface PrEntry extends PrComment {
  kind: "comment" | "review" | "thread";
  /** Reviews only. */
  reviewState: "approved" | "changes" | "commented" | "dismissed" | null;
  /** Inline threads only. */
  path: string | null;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  replies: PrComment[];
  /** Latest create/edit across the entry and its replies (ISO). */
  activityAt: string;
}

export interface PrThread {
  url: string;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  author: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  reviewDecision: "approved" | "changes" | "review" | null;
  /** CI rollup on the head commit; null when the PR has no checks. */
  checks: "ok" | "fail" | "pending" | null;
  updatedAt: string;
  /** Newest activity first. */
  entries: PrEntry[];
}

/** PR URLs a workspace's agent raised or mentioned, most relevant first. */
export function workspacePrs(workspaceId: string): Promise<string[]> {
  return invoke("workspace_prs", { workspaceId });
}

export function prThread(workspaceId: string, prUrl: string): Promise<PrThread> {
  return invoke("pr_thread", { workspaceId, prUrl });
}
