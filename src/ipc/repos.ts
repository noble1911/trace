import { invoke } from "@tauri-apps/api/core";

// Multi-repo config: the list of configured repos and per-issue assignments.

export function listRepos(): Promise<string[]> {
  return invoke("list_repos");
}

export function addRepo(path: string): Promise<string[]> {
  return invoke("add_repo", { path });
}

export function removeRepo(path: string): Promise<string[]> {
  return invoke("remove_repo", { path });
}

/** The repo an issue is assigned to, or null. */
export function issueRepo(issueKey: string): Promise<string | null> {
  return invoke("issue_repo", { issueKey });
}

export function setIssueRepo(issueKey: string, path: string): Promise<void> {
  return invoke("set_issue_repo", { issueKey, path });
}

/** A ticket→repo rule: keys containing `pattern` (case-insensitive) use `repo`. */
export interface RepoMapping {
  pattern: string;
  repo: string;
}

export function listRepoMappings(): Promise<RepoMapping[]> {
  return invoke("list_repo_mappings");
}

/** Replace the whole mapping list; returns it sanitized. */
export function setRepoMappings(mappings: RepoMapping[]): Promise<RepoMapping[]> {
  return invoke("set_repo_mappings", { mappings });
}
