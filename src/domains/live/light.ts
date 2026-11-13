import type { AgentLight, Ask, LiveInfo } from "./types";

export const LIGHT_LABEL: Record<AgentLight, string> = {
  attention: "Needs you",
  working: "Working",
  ready: "Ready",
  stopped: "Stopped",
};

interface LightInputs {
  running: boolean;
  /** The board store's turn signal; absent = just started, so working. */
  activity: "working" | "waiting" | undefined;
  /** A pending hook-reported ask (permission, question, plan). */
  ask: Ask | null;
}

/**
 * One agent's light. Only a pending ask needs you, even after you've looked —
 * seeing a permission prompt isn't answering it. A plain finished turn is
 * `ready`, seen or not: "new since you looked" is weight (`unread.ts`), never
 * amber. Activity can flicker on a repaint, so an ask outranks it.
 */
export function lightOf({ running, activity, ask }: LightInputs): AgentLight {
  if (!running) return "stopped";
  if (ask) return "attention";
  if ((activity ?? "working") === "working") return "working";
  return "ready";
}

/** What a light says the agent wants, for its pill: the hook's ask. */
export function shownAsk(info: Pick<LiveInfo, "light" | "ask"> | undefined): Ask | null {
  return info?.light === "attention" ? info.ask : null;
}

// Which light a group of agents shows: the one most worth your attention.
const LIGHT_RANK: AgentLight[] = ["attention", "working", "ready", "stopped"];

/** The most urgent of several lights (a session's agents, say). */
export function mostUrgent(lights: AgentLight[]): AgentLight {
  return LIGHT_RANK.find((l) => lights.includes(l)) ?? "stopped";
}

/** "45s" / "6m" / "2h" / "3d" — how long something has been the way it is. */
export function ageLabel(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
