import type { AgentCli } from "@/ipc/agent";

/** An exploratory session — an interactive agent not tied to a Jira issue. */
export interface ScratchSession {
  id: string;
  title: string;
  cli: AgentCli;
  /** Unix epoch seconds at creation. */
  createdAt: number;
  /** Epoch seconds when archived (recycle bin); null/undefined = active. */
  archivedAt?: number | null;
  /** Owning tab id; null/undefined = the default tab. */
  tab?: string | null;
  /** Section id within the tab; null/undefined = unsectioned. */
  section?: string | null;
  /** Runs in its own worktree (linkable to a ticket). Legacy sessions don't. */
  worktree?: boolean;
  /** Configured repo path this session runs in; null/undefined = default repo. */
  repo?: string | null;
}

/** A top-level view on the Sessions page (e.g. one per repo). */
export interface SessionTab {
  id: string;
  name: string;
}

/** A collapsible group of sessions within a tab. */
export interface SessionSection {
  id: string;
  name: string;
  /** Owning tab id; null/undefined = the default tab. */
  tab?: string | null;
  collapsed: boolean;
}

/** The whole organisation structure — array order is display order. */
export interface SessionGroups {
  tabs: SessionTab[];
  sections: SessionSection[];
}
