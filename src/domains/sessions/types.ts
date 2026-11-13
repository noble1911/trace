import type { AgentCli, AgentProvider } from "@/ipc/agent";

/**
 * A companion agent on a session: a second CLI running in the *same* worktree,
 * so work started with one agent can be continued by another. Its `id` is a
 * workspace id in its own right — the PTY, conversation, and run-state are all
 * keyed by it, exactly like a session's or an issue's.
 */
export interface SessionAgent {
  id: string;
  cli: AgentCli;
  /** Model provider for the Claude harness; null/undefined = Anthropic. */
  provider?: AgentProvider | null;
}

/**
 * Who started a session (`commands/session_origin.rs`). Absent = the user, which
 * is also what every session saved before this was recorded reads as. An agent's
 * `workspaceId` is the session that hosts it or the ticket's key; `label` is the
 * parent's title or key at the time, so it reads well after the parent is gone.
 */
export type CreatedBy =
  | { kind: "user" }
  | { kind: "agent"; workspaceId: string; parent: "session" | "ticket"; label: string }
  | { kind: "orchestrator" }
  | { kind: "schedule"; promptId: string; runId?: string | null; label: string };

/** Where a session can run other than this computer. */
export type SessionHostKind = "vercel" | "peer";

/**
 * A session that runs somewhere else: today a Vercel Sandbox (`sandbox` is its
 * name; `remote` is the repo's GitHub remote it cloned). It has no local folder,
 * so nothing that reads the worktree (Files, Terminal, Tests) applies; its PRs are
 * found on GitHub from its branch.
 */
export interface SessionHost {
  kind: SessionHostKind;
  sandbox: string;
  remote: string | null;
  /** kind "peer": the paired peer's id (its name comes from the peer list). */
  peer?: string;
}

/** An exploratory session — an interactive agent not tied to a Jira issue. */
export interface ScratchSession {
  id: string;
  title: string;
  cli: AgentCli;
  /** Model provider for the Claude harness; null/undefined = Anthropic. */
  provider?: AgentProvider | null;
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
  /** Plain folder it runs in when it has no repo; no git features apply there. */
  folder?: string | null;
  /** Extra agents sharing this session's worktree (empty/undefined = just one). */
  agents?: SessionAgent[];
  /** Started with Remote Control — also drivable from claude.ai/code. */
  remoteControl?: boolean;
  /** Who started it; null/undefined = the user. */
  createdBy?: CreatedBy | null;
  /** Where it runs; null/undefined = this computer. */
  host?: SessionHost | null;
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
