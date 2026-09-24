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

export interface SessionPrRef {
  number: number;
  state: "open" | "draft" | "merged" | "closed";
  url: string;
}

/** One Sessions-list row's checkout facts. */
export interface SessionOverview {
  id: string;
  /** Repo root path. */
  repo: string;
  branch: string | null;
  pr: SessionPrRef | null;
}

/** Branch + PR for many sessions in one go (one `gh` call per repo). */
export function sessionsOverview(ids: string[]): Promise<SessionOverview[]> {
  return invoke("sessions_overview", { ids });
}
