import { useEffect, useMemo, useState } from "react";
import { useActivityStore } from "@/domains/activity/store";
import { useBoardStore } from "@/domains/board/store";
import { countAgents, deriveMood } from "../mood";
import type { Mood } from "../spriteContract";
import { useBuddyStore } from "../store";

/** Re-derive at least this often, so time-windowed moods (happy, sleeping) expire. */
const TICK_MS = 5_000;

/** The buddy's current mood, live from the board and the activity log. */
export function useBuddyMood(): Mood {
  const events = useActivityStore((s) => s.events);
  const running = useBoardStore((s) => s.runningAgents);
  const activity = useBoardStore((s) => s.agentActivity);
  const acked = useBoardStore((s) => s.ackedWaiting);
  const lastInteractionAt = useBuddyStore((s) => s.lastInteractionAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    const { working, waiting } = countAgents(running, activity, acked);
    return deriveMood({
      events,
      workingAgents: working,
      waitingAgents: waiting,
      // An event newer than the last tick still counts as "just now".
      now: Math.max(now, events[0]?.at ?? 0),
      lastInteractionAt,
    });
  }, [events, running, activity, acked, now, lastInteractionAt]);
}
