import { invoke } from "@tauri-apps/api/core";
import type {
  BoardData,
  BoardSummary,
  IssueComment,
  IssueUser,
  ProviderKind,
  ProviderSession,
  PullRequest,
} from "@/domains/issues/types";

// Typed wrappers around the issue-tracker Tauri commands. Components import
// these — never call `invoke` directly. Several providers can be connected at
// once, so every board command names its provider. Tauri maps camelCase args
// to the snake_case Rust params.

export function connectJira(site: string, email: string, token: string): Promise<IssueUser> {
  return invoke("connect_jira", { site, email, token });
}

/** A tracker site an MCP login reaches (Jira: one per Atlassian site; Pylon has none). */
export interface TrackerSite {
  /** Jira's cloudId. */
  id: string;
  name: string;
  url: string;
}

/** How connecting over a tracker's MCP server ended: connected, or (when the
 * login reaches several sites) a choice to connect again with. */
export type McpConnectResult =
  | { status: "connected"; user: IssueUser; session: ProviderSession }
  | { status: "chooseSite"; sites: TrackerSite[] };

/** Connect Jira's board through trace's Atlassian login (Integrations → MCP servers),
 * logging in through the browser first if need be. `cloudId` picks the site. */
export function connectJiraMcp(cloudId?: string): Promise<McpConnectResult> {
  return invoke("connect_jira_mcp", { cloudId: cloudId ?? null });
}

/** A Pylon data region: its workspaces have separate logins and MCP servers. */
export type PylonRegion = "us" | "eu";

/** Connect Pylon's board through trace's Pylon login (Integrations → MCP servers), logging in
 * through the browser first if need be. Without `region`, the server trace is logged in to (or
 * the region it already knows, else US). Never resolves to a site choice. */
export function connectPylonMcp(region?: PylonRegion): Promise<McpConnectResult> {
  return invoke("connect_pylon_mcp", { region: region ?? null });
}

export function connectPylon(token: string): Promise<IssueUser> {
  return invoke("connect_pylon", { token });
}

export function providerSessions(): Promise<ProviderSession[]> {
  return invoke("provider_sessions");
}

export function providerCurrentUser(provider: ProviderKind): Promise<IssueUser> {
  return invoke("provider_current_user", { provider });
}

export function disconnectProvider(provider: ProviderKind): Promise<void> {
  return invoke("disconnect_provider", { provider });
}

export function listBoards(provider: ProviderKind): Promise<BoardSummary[]> {
  return invoke("list_boards", { provider });
}

export function getBoard(provider: ProviderKind, boardId: string): Promise<BoardData> {
  return invoke("get_board", { provider, boardId });
}

export function transitionIssue(
  provider: ProviderKind,
  issueKey: string,
  targetStatusIds: string[]
): Promise<void> {
  return invoke("transition_issue", { provider, issueKey, targetStatusIds });
}

/** Post a plain-text comment/note on an issue (ADF on Jira, note on Pylon). */
export function commentOnIssue(
  provider: ProviderKind,
  issueKey: string,
  body: string
): Promise<void> {
  return invoke("comment_on_issue", { provider, issueKey, body });
}

/** Recent entries in an issue's discussion thread, oldest-first (Jira
 * comments; Pylon conversation incl. internal notes). Providers without a
 * readable thread return []. */
export function listIssueComments(
  provider: ProviderKind,
  issueId: string
): Promise<IssueComment[]> {
  return invoke("list_issue_comments", { provider, issueId });
}

/** PRs linked to an issue. `fresh` busts Jira's dev-status cache — use for
 * targeted single-issue refreshes, not bulk fan-outs. Providers without a
 * dev-status integration return an empty list. */
export function getIssuePullRequests(
  provider: ProviderKind,
  issueId: string,
  fresh = false
): Promise<PullRequest[]> {
  return invoke("get_issue_pull_requests", { provider, issueId, fresh });
}
