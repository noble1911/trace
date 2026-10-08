import { useCallback, useEffect, useRef } from "react";
import { useActivityStore } from "@/domains/activity/store";
import type { ActivityEvent } from "@/domains/activity/types";
import { useBoardStore } from "@/domains/board/store";
import { countAgents } from "../mood";
import { type BoardGlance, buildPrompt, type Occasion } from "../prompt";
import {
  BATCH_MS,
  linkFor,
  POKE_GAP_MS,
  trimPending,
  underHourlyCap,
  waitBeforeSpeaking,
} from "../speech";
import { useBuddyStore } from "../store";
import { speak } from "../voice";

/** Away (window unfocused) at least this long → a "welcome back" digest. */
const WELCOME_BACK_MS = 5 * 60_000;
/** Re-check a batch held back by the hourly cap this often. */
const CAPPED_RETRY_MS = 60_000;
/** Context for a poke: what happened in the last hour. */
const POKE_CONTEXT_MS = 3_600_000;

function glance(): BoardGlance {
  const b = useBoardStore.getState();
  return {
    boardName: b.data?.boardName ?? null,
    ...countAgents(b.runningAgents, b.agentActivity, b.ackedWaiting),
  };
}

const isMuted = () => useBuddyStore.getState().mutedUntil > Date.now();

/**
 * The buddy's speech loop: collects new activity events, waits for bursts to
 * settle, and asks the LLM for one line when `speech.ts` allows it. While the
 * window is unfocused, events are held; coming back after a while gets a digest.
 * Mounted only while the buddy is enabled — disabled means zero calls.
 */
export function useBuddyBrain(name: string): { poke: () => void } {
  // Read at call time, so switching characters doesn't reset the loop.
  const nameRef = useRef(name);
  nameRef.current = name;
  const pending = useRef<ActivityEvent[]>([]);
  const lastSpokeAt = useRef(0);
  const callTimes = useRef<number[]>([]);
  const recentLines = useRef<string[]>([]);
  const busy = useRef(false);
  const alive = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const awaySince = useRef<number | null>(document.hasFocus() ? null : Date.now());

  const talk = useCallback(async (occasion: Occasion, events: ActivityEvent[]) => {
    const now = Date.now();
    busy.current = true;
    lastSpokeAt.current = now;
    callTimes.current = [...callTimes.current.filter((t) => now - t < 3_600_000), now];
    const prompt = buildPrompt({
      occasion,
      events,
      board: glance(),
      recentLines: recentLines.current,
      now,
    });
    const line = await speak(prompt, nameRef.current);
    busy.current = false;
    if (!line || !alive.current || isMuted()) return;
    recentLines.current = [...recentLines.current, line].slice(-5);
    useBuddyStore.getState().say(line, linkFor(events));
  }, []);

  const flush = useCallback(() => {
    timer.current = undefined;
    if (isMuted()) {
      pending.current = [];
      return;
    }
    if (awaySince.current !== null) return; // held until focus returns
    const reschedule = (ms: number) => {
      timer.current = window.setTimeout(flush, ms);
    };
    if (busy.current) return reschedule(1_000);
    const now = Date.now();
    const wait = waitBeforeSpeaking(pending.current, lastSpokeAt.current, callTimes.current, now);
    if (wait === null) {
      if (pending.current.length) reschedule(CAPPED_RETRY_MS);
      return;
    }
    if (wait > 0) return reschedule(wait);
    const events = pending.current;
    pending.current = [];
    void talk("events", events);
  }, [talk]);

  const restart = useCallback(
    (ms: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, ms);
    },
    [flush]
  );

  useEffect(() => {
    alive.current = true;
    const mountedAt = Date.now();
    let seen = new Set(useActivityStore.getState().events.map((e) => e.id));
    const unsubscribe = useActivityStore.subscribe((s) => {
      // Only news from now on — not history the feed loaded.
      const fresh = s.events.filter((e) => !seen.has(e.id) && e.at >= mountedAt - BATCH_MS);
      seen = new Set(s.events.map((e) => e.id));
      if (!fresh.length) return;
      pending.current = trimPending([...pending.current, ...fresh]);
      restart(BATCH_MS);
    });

    const onBlur = () => {
      awaySince.current ??= Date.now();
    };
    const onFocus = () => {
      const away = awaySince.current === null ? 0 : Date.now() - awaySince.current;
      awaySince.current = null;
      const now = Date.now();
      const canDigest = !busy.current && !isMuted() && underHourlyCap(callTimes.current, now);
      if (away >= WELCOME_BACK_MS && pending.current.length && canDigest) {
        const events = pending.current;
        pending.current = [];
        void talk("welcome-back", events);
      } else if (pending.current.length) {
        restart(BATCH_MS);
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      unsubscribe();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer.current);
    };
  }, [restart, talk]);

  const poke = useCallback(() => {
    useBuddyStore.getState().touch();
    const now = Date.now();
    if (isMuted() || busy.current) return;
    if (now - lastSpokeAt.current < POKE_GAP_MS || !underHourlyCap(callTimes.current, now)) return;
    window.clearTimeout(timer.current);
    const context = pending.current.length
      ? pending.current
      : useActivityStore
          .getState()
          .events.filter((e) => now - e.at < POKE_CONTEXT_MS)
          .slice(0, 6);
    pending.current = [];
    void talk("poke", context);
  }, [talk]);

  return { poke };
}
