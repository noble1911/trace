import { TURN_FINISHED } from "./ask";
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
  /** The user has looked at this agent since its turn ended. */
  acked: boolean;
  /** A pending hook-reported ask (permission, question, plan). */
  ask: Ask | null;
  /** Scheduled runs: their quiet pauses are the runner's business, not news. */
  scheduled: boolean;
}

/**
 * One agent's light. A pending ask needs you even after you've looked — seeing
 * a permission prompt isn't answering it — while a plain finished turn settles
 * to `ready` once seen. Activity can flicker on a repaint, so an ask outranks it.
 */
export function lightOf({ running, activity, acked, ask, scheduled }: LightInputs): AgentLight {
  if (!running) return "stopped";
  if (ask) return "attention";
  if ((activity ?? "working") === "working") return "working";
  if (scheduled) return "ready";
  return acked ? "ready" : "attention";
}

/** What a light says the agent wants, for its pill: the hook's ask, or "Turn finished". */
export function shownAsk(info: Pick<LiveInfo, "light" | "ask"> | undefined): Ask | null {
  if (info?.light !== "attention") return null;
  return info.ask ?? TURN_FINISHED;
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
