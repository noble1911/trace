// Frontend mirror of the Rust jira::models shapes (camelCase over IPC).

export interface JiraUser {
  accountId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface JiraSession {
  site: string;
  email: string;
}

export interface BoardSummary {
  id: number;
  name: string;
  boardType: string;
}

/** A board column and the status ids that map into it (board's configured order). */
export interface ColumnStatus {
  id: string;
  name: string;
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

/** Jira status category: drives the column dot hue. */
export type StatusCategory = "new" | "indeterminate" | "done";

export interface Issue {
  /** Numeric Jira id (as a string). Needed for dev-status / PR lookups. */
  id: string;
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
  epic?: string | null;
  reporter?: string | null;
}

export interface BoardData {
  boardId: number;
  boardName: string;
  sprintName?: string | null;
  columns: BoardColumn[];
  issues: Issue[];
}

/** A GitHub PR linked to a Jira issue via the dev-status integration. */
export interface PullRequest {
  number: string;
  url: string;
  /** `open` | `merged` | `declined` | `draft` (lower-cased to match CSS classes). */
  state: string;
  title: string;
}
