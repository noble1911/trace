import { agentLabel } from "@/domains/agent/providerLabel";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
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
 * What a status light says about an agent. Four states, because "alive but
 * idle" is not "stopped": an agent you've already looked at that's sitting at
 * its prompt is `ready`, not off.
 */
export type AgentLight = "working" | "attention" | "ready" | "stopped";

export const LIGHT_LABEL: Record<AgentLight, string> = {
  working: "Working",
  attention: "Needs you",
  ready: "Ready",
  stopped: "Stopped",
};

/** One agent's light: running + mid-turn, waiting unseen, waiting seen, or not running. */
export function agentLight(
  workspaceId: string,
  running: Set<string>,
  activity: Record<string, "working" | "waiting">,
  acked: Set<string>
): AgentLight {
  if (!running.has(workspaceId)) return "stopped";
  if ((activity[workspaceId] ?? "working") === "working") return "working";
  return acked.has(workspaceId) ? "ready" : "attention";
}

// Which light a multi-agent session shows: the one most worth your attention.
const LIGHT_RANK: AgentLight[] = ["attention", "working", "ready", "stopped"];

/**
 * A session's light across *all* its agents — a card whose codex companion is
 * waiting on you reads as "needs you" even if its claude agent is mid-turn.
 * `detail` breaks it down per agent when there's more than one (for a tooltip).
 */
export function sessionLight(
  session: ScratchSession,
  running: Set<string>,
  activity: Record<string, "working" | "waiting">,
  acked: Set<string>
): { light: AgentLight; detail: string } {
  const roster = agentRoster(session);
  const lights = roster.map((r) => agentLight(r.workspaceId, running, activity, acked));
  const light = LIGHT_RANK.find((l) => lights.includes(l)) ?? "stopped";
  const detail =
    roster.length > 1
      ? roster.map((r, i) => `${r.label}: ${LIGHT_LABEL[lights[i]].toLowerCase()}`).join(" · ")
      : LIGHT_LABEL[light];
  return { light, detail };
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
  // A third-party-backed claude reads as the model it runs (e.g. "kimi") so
  // it's distinguishable from an Anthropic-backed one sharing the worktree.
  const label = (cli: AgentCli, provider?: AgentProvider | null) => {
    const base = agentLabel(cli, provider);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  };
  return [
    {
      workspaceId: session.id,
      cli: session.cli,
      label: label(session.cli, session.provider),
      companion: false,
    },
    ...companionsOf(session).map((a) => ({
      workspaceId: a.id,
      cli: a.cli,
      label: label(a.cli, a.provider),
      companion: true,
    })),
  ];
}
