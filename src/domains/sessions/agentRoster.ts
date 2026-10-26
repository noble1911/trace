import { agentLabel } from "@/domains/agent/providerLabel";
import { LIGHT_LABEL, mostUrgent } from "@/domains/live/light";
import type { AgentLight, LiveInfo } from "@/domains/live/types";
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
 * A session's light across *all* its agents — a card whose codex companion is
 * waiting on you reads as "needs you" even if its claude agent is mid-turn.
 * `detail` breaks it down per agent when there's more than one (for a tooltip).
 */
export function sessionLight(
  session: ScratchSession,
  info: Record<string, LiveInfo>
): { light: AgentLight; detail: string } {
  const roster = agentRoster(session);
  const lights = roster.map((r) => info[r.workspaceId]?.light ?? "stopped");
  const light = mostUrgent(lights);
  const detail =
    roster.length > 1
      ? roster.map((r, i) => `${r.label}: ${LIGHT_LABEL[lights[i]].toLowerCase()}`).join(" · ")
      : LIGHT_LABEL[light];
  return { light, detail };
}

/**
 * Whether any agent on this session needs you. Per agent, so a session keeps
 * flagging while its codex companion waits, even after you've seen the claude one.
 */
export function sessionNeedsYou(session: ScratchSession, info: Record<string, LiveInfo>): boolean {
  return agentWorkspaceIds(session).some((id) => info[id]?.light === "attention");
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
