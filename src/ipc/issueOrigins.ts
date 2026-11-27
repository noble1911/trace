import { invoke } from "@tauri-apps/api/core";
import type { CreatedBy } from "@/domains/sessions/types";

// Who started each ticket's agent (`commands/issue_origin.rs`): a ticket's
// counterpart of a session's `createdBy`. A ticket with no entry was started by you.

/** Every ticket whose agent something other than you started, by issue key. */
export function issueOrigins(): Promise<Record<string, CreatedBy>> {
  return invoke<Record<string, CreatedBy>>("issue_origins");
}

/** Record who started `issueKey`'s agent; the user clears its entry. */
export function setIssueOrigin(issueKey: string, createdBy: CreatedBy): Promise<void> {
  return invoke("set_issue_origin", { issueKey, createdBy });
}
