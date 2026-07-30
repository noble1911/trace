import type { SessionStatus } from "@/domains/board/store";
import type { AgentCli } from "@/ipc/agent";
import type { ScratchSession, SessionAgent } from "./types";

/**
 * One entry per agent on a session — the session's own agent first, then each
 * companion in the order they were added. This is the list the detail view turns
 * into tabs, and it's what makes the primary agent and its companions
 * interchangeable everywhere downstream: both are just a workspace id + a CLI.
 */
export interface RosterEntry {
  /** Workspace id: the session's id for the primary, the companion's own id. */
  workspaceId: string;
  cli: AgentCli;
  /** Display label — the CLI name, numbered when a CLI appears more than once. */
  label: string;
  /** False for the session's own agent (which can't be removed on its own). */
  companion: boolean;
}

/**
 * How many companions a session may host — mirrors `MAX_AGENTS` in
 * `commands/session_agents.rs`, which is what actually enforces it.
 */
export const MAX_COMPANIONS = 4;

/** Companions of a session, tolerating the field's absence on old records. */
export function companionsOf(session: ScratchSession): SessionAgent[] {
  return session.agents ?? [];
}

/** Every workspace id a session runs agents under (primary + companions). */
export function agentWorkspaceIds(session: ScratchSession): string[] {
  return [session.id, ...companionsOf(session).map((a) => a.id)];
}

/**
 * A session's status across *all* its agents: working beats waiting beats idle.
 * A card whose codex companion is mid-turn should read as busy even if the agent
 * the session was created with is stopped.
 *
 * (Only the type comes from the board store — deriving the state here rather than
 * calling into it keeps this module free of a runtime import cycle.)
 */
export function sessionStatus(
  session: ScratchSession,
  running: Set<string>,
  activity: Record<string, "working" | "waiting">
): SessionStatus {
  const states = agentWorkspaceIds(session).map((id) =>
    running.has(id) ? (activity[id] ?? "working") : "idle"
  );
  if (states.includes("working")) return "working";
  if (states.includes("waiting")) return "waiting";
  return "idle";
}

/**
 * Whether any agent on this session is waiting on input the user hasn't looked at
 * yet — the "needs you" flag. Acknowledgement is per agent, so a session keeps
 * flagging while its codex companion waits, even after you've seen the claude one.
 */
export function sessionNeedsYou(
  session: ScratchSession,
  running: Set<string>,
  activity: Record<string, "working" | "waiting">,
  acked: Set<string>
): boolean {
  return agentWorkspaceIds(session).some(
    (id) => running.has(id) && activity[id] === "waiting" && !acked.has(id)
  );
}

/**
 * Human label for any workspace id belonging to a session, for notifications:
 * the session title, plus the agent's name when it's a companion (they share the
 * session's title, so "· codex" is what tells them apart).
 */
export function workspaceTitle(sessions: ScratchSession[], workspaceId: string): string | null {
  for (const session of sessions) {
    const entry = agentRoster(session).find((r) => r.workspaceId === workspaceId);
    if (entry) return entry.companion ? `${session.title} · ${entry.label}` : session.title;
  }
  return null;
}

/**
 * Build the roster. Labels number repeats so two claude agents read as
 * "claude" / "claude 2" rather than two identical tabs.
 */
export function agentRoster(session: ScratchSession): RosterEntry[] {
  const seen = new Map<string, number>();
  const label = (cli: AgentCli) => {
    const n = (seen.get(cli) ?? 0) + 1;
    seen.set(cli, n);
    return n === 1 ? cli : `${cli} ${n}`;
  };
  return [
    { workspaceId: session.id, cli: session.cli, label: label(session.cli), companion: false },
    ...companionsOf(session).map((a) => ({
      workspaceId: a.id,
      cli: a.cli,
      label: label(a.cli),
      companion: true,
    })),
  ];
}
