import { invoke } from "@tauri-apps/api/core";

export interface WorktreeInfo {
  repo: string;
  path: string;
  /** Directory name under .worktrees/ — the issue's slug. */
  name: string;
  branch: string | null;
  /** Branch already contained in the default branch — safe to delete. */
  merged: boolean;
  /** Uncommitted changes present (removal would lose work). */
  dirty: boolean;
  /** A live PTY is rooted here — removal is blocked. */
  running: boolean;
}

export function listWorktrees(): Promise<WorktreeInfo[]> {
  return invoke("list_worktrees");
}

export function removeWorktree(
  repo: string,
  path: string,
  branch: string | null,
  force: boolean
): Promise<void> {
  return invoke("remove_worktree", { repo, path, branch, force });
}
