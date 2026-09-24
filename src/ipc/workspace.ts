import { invoke } from "@tauri-apps/api/core";

// Typed wrapper around `commands/workspace.rs`.

export interface WorkspaceInfo {
  /** The repo's root (main checkout). */
  repo: string;
  /** Where the agent runs: its worktree, or the repo root before one exists. */
  cwd: string;
  isWorktree: boolean;
  /** The branch actually checked out; null when detached. */
  branch: string | null;
}

/** A workspace's repo, cwd and live branch; null before it has a repo. */
export function workspaceInfo(workspaceId: string): Promise<WorkspaceInfo | null> {
  return invoke("workspace_info", { workspaceId });
}
