import { create } from "zustand";

export type ActivityKind =
  | "transition"
  | "agent-start"
  | "pr-raised"
  | "pr-merged"
  | "session-created";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** Issue key for the chip, when the event is tied to one. */
  issueKey?: string;
  /** Human description shown after the key chip, e.g. "→ In Review". */
  title: string;
  /** Epoch ms. */
  at: number;
}

const STORAGE_KEY = "trace.activity";
const CAP = 100;

function load(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

function save(events: ActivityEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // best-effort persistence
  }
}

// Monotonic suffix so two events in the same millisecond get distinct keys.
let seq = 0;

interface ActivityStore {
  events: ActivityEvent[];
  log: (e: { kind: ActivityKind; issueKey?: string; title: string }) => void;
  clear: () => void;
}

// Persisted to localStorage so the feed survives restarts. The events originate
// frontend-side (transitions, agent starts, PR actions), so no backend store.
export const useActivityStore = create<ActivityStore>((set, get) => ({
  events: load(),
  log({ kind, issueKey, title }) {
    const at = Date.now();
    const event: ActivityEvent = { id: `${at}-${seq++}`, kind, issueKey, title, at };
    const events = [event, ...get().events].slice(0, CAP);
    save(events);
    set({ events });
  },
  clear() {
    save([]);
    set({ events: [] });
  },
}));

// Imperative helper for non-component call sites (stores, async handlers).
export const activity = {
  log: (e: { kind: ActivityKind; issueKey?: string; title: string }) =>
    useActivityStore.getState().log(e),
};
