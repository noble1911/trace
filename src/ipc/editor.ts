import { invoke } from "@tauri-apps/api/core";

export type Editor = "vscode" | "intellij" | "cursor";

/** Open the issue's worktree (or repo root) in a desktop editor. */
export function openInEditor(issueKey: string, editor: Editor): Promise<void> {
  return invoke("open_in_editor", { issueKey, editor });
}
