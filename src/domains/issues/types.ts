// Frontend mirror of the Rust issues::models shapes (camelCase over IPC).
// Provider-agnostic: every issue tracker (Jira, Pylon) maps into these.

export type ProviderKind = "jira" | "pylon";

/** The non-secret session descriptor (never carries tokens). */
export interface ProviderSession {
  provider: ProviderKind;
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
