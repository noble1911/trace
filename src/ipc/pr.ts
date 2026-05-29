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
