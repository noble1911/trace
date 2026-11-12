// Frontend mirror of the Rust issues::models shapes (camelCase over IPC).
// Provider-agnostic: every issue tracker (Jira, Pylon, trace's own custom boards) maps
// into these.

/** The tracker an issue lives in. `custom` is trace's own boards (always connected). */
export type ProviderKind = "jira" | "pylon" | "custom";

/** A custom-board card's key: `local-<digits>`, lowercase so it's never a Jira key. */
const CUSTOM_KEY = /^local-\d+$/;

/** Which tracker an issue key came from: Pylon's are `#123`, custom cards' `local-12`,
 * Jira's `ABC-123`. Mirrors the backend's `ProviderKind::for_issue_key`. */
export function trackerForIssueKey(key: string): ProviderKind {
  if (key.startsWith("#")) return "pylon";
  if (CUSTOM_KEY.test(key)) return "custom";
  return "jira";
}

/** How a tracker is connected: its API key, trace's MCP login, or local (custom boards). */
export type ProviderVia = "api" | "mcp" | "local";

/** The non-secret session descriptor (never carries tokens). */
export interface ProviderSession {
  provider: ProviderKind;
  /** Display only: which way it's connected. */
  via: ProviderVia;
  /** Jira only — used for display and browse links. */
  site?: string | null;
  /** Jira only. */
  email?: string | null;
}

/** The authenticated user of the active provider. */
export interface IssueUser {
  /** Provider-specific user id (Jira accountId, Pylon user id). */
  accountId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface BoardSummary {
  /** Opaque across providers (numeric on Jira, virtual on Pylon). */
  id: string;
  name: string;
  boardType: string;
}

/**
 * One entry in the board switcher. Several providers can be connected at once,
 * so boards from all of them merge into one list, namespaced by provider:
 * the key is `${provider}:${boardId}` (e.g. "jira:42", "pylon:open-issues").
 */
export interface BoardOption {
  key: string;
  provider: ProviderKind;
  boardId: string;
  name: string;
}

export function boardOptionKey(provider: ProviderKind, boardId: string): string {
  return `${provider}:${boardId}`;
}

/** A board column and the status ids that map into it (board's configured order). */
export interface ColumnStatus {
  id: string;
  name: string;
  /** Status category — "indeterminate" marks in-progress-ish statuses. */
  category: StatusCategory;
}

export interface BoardColumn {
  name: string;
  /** A column can map to several statuses (e.g. In Progress + Blocked). */
  statuses: ColumnStatus[];
}

export interface Assignee {
  accountId: string;
  displayName: string;
  initial: string;
  avatarUrl?: string | null;
}

/** Priority accent code used by the card's color bar. */
export type Priority = "p0" | "p1" | "p2" | "p3";

/** Status category: drives the column dot hue and the active filter. */
export type StatusCategory = "new" | "indeterminate" | "done";

export interface Issue {
  /** Provider-native id (Jira numeric id for dev-status lookups; Pylon issue id). */
  id: string;
  /** Display key (Jira `TRACE-12`, Pylon `#123`). */
  key: string;
  summary: string;
  statusId: string;
  statusName: string;
  statusCategory: StatusCategory;
  priority: Priority;
  issueType: string;
  labels: string[];
  assignee?: Assignee | null;
  description?: string | null;
  /** Grouping label for display (Jira epic; unused on Pylon). */
  epic?: string | null;
  /** Epic issue key, for the browse link (Jira only). */
  epicKey?: string | null;
  /** Jira's epic palette key ("color_1"…"color_14"), when the API carries it. */
  epicColor?: string | null;
  reporter?: string | null;
  /** Provider-native web URL for the issue, when the API carries one. */
  browseUrl?: string | null;
}

export interface BoardData {
  boardId: string;
  boardName: string;
  sprintName?: string | null;
  columns: BoardColumn[];
  issues: Issue[];
}

/** A GitHub PR linked to an issue (Jira's dev-status integration only). */
export interface PullRequest {
  number: string;
  url: string;
  /** `open` | `merged` | `declined` | `draft` (lower-cased to match CSS classes). */
  state: string;
  title: string;
}

/** One entry in an issue's discussion thread (Jira comment; Pylon customer
 * message or internal note), oldest-first over IPC. */
export interface IssueComment {
  author: string;
  created?: string | null;
  /** Internal note never shown to the customer (Pylon `is_private`). */
  isInternal: boolean;
  body: string;
}
