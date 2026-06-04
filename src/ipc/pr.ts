import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around the PR commands.

export interface RaisedPr {
  url: string;
}

export function raisePr(issueKey: string, title: string, body: string): Promise<RaisedPr> {
  return invoke("raise_pr", { issueKey, title, body });
}

export function mergePr(prUrl: string, method?: "squash" | "merge" | "rebase"): Promise<void> {
  return invoke("merge_pr", { prUrl, method: method ?? null });
}

export interface PrCheck {
  name: string;
  /** ok | fail | pending */
  status: string;
  meta: string;
}

export interface PrReview {
  who: string;
  /** approved | changes | commented */
  action: string;
  /** ISO timestamp */
  when: string;
}

export interface PrDetails {
  number: number;
  title: string;
  /** OPEN | MERGED | CLOSED */
  state: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  checks: PrCheck[];
  reviews: PrReview[];
}

export function prDetails(prUrl: string): Promise<PrDetails> {
  return invoke("pr_details", { prUrl });
}
