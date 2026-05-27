import { invoke } from "@tauri-apps/api/core";
import type { BoardData, BoardSummary, JiraSession, JiraUser } from "@/domains/jira/types";

// Typed wrappers around the Jira Tauri commands. Components import these — never
// call `invoke` directly. Tauri maps camelCase args to the snake_case Rust params.

export function connectJira(site: string, email: string, token: string): Promise<JiraUser> {
  return invoke("connect_jira", { site, email, token });
}

export function jiraSession(): Promise<JiraSession | null> {
  return invoke("jira_session");
}

export function disconnectJira(): Promise<void> {
  return invoke("disconnect_jira");
}

export function listJiraBoards(): Promise<BoardSummary[]> {
  return invoke("list_jira_boards");
}

export function getJiraBoard(boardId: number): Promise<BoardData> {
  return invoke("get_jira_board", { boardId });
}

export function transitionJiraIssue(issueKey: string, targetStatusIds: string[]): Promise<void> {
  return invoke("transition_jira_issue", { issueKey, targetStatusIds });
}
