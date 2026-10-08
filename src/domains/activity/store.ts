import { create } from "zustand";
import { clearActivity, importActivity, listActivity, recordActivity } from "@/ipc/activity";
import type { ActivityEvent, ActivityInput } from "./types";

// The activity feed: a renderer cache of the backend's persisted log
// (`src-tauri/src/activity`). Every producer — renderer actions here, Claude
// hooks / PTY exits / scheduled runs in Rust — lands in that one log, and new
// events stream in via `activity-event` (`useActivityFeed`).

/** The pre-backend feed lived here; it's imported once, then removed. */
const LEGACY_KEY = "trace.activity";
const CAP = 1000;

interface ActivityStore {
  events: ActivityEvent[];
  /** Load the log (importing the legacy localStorage feed first, once). */
  hydrate: () => Promise<void>;
  /** Merge in an event from the backend (deduped by id, newest first). */
  receive: (event: ActivityEvent) => void;
  log: (input: ActivityInput) => void;
  clear: () => void;
}

function readLegacy(): ActivityEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Omit<ActivityEvent, "actor"> => {
        const o = e as Partial<ActivityEvent> | null;
        return typeof o?.id === "string" && typeof o.at === "number" && typeof o.kind === "string";
      })
      .map((e) => ({ ...e, actor: "user" }));
  } catch {
    return [];
  }
}

async function migrateLegacy(): Promise<void> {
  const legacy = readLegacy();
  if (legacy.length === 0) return;
  await importActivity(legacy);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // best-effort — the backend import is a no-op once the log has events
  }
}

function merge(a: ActivityEvent[], b: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const e of [...a, ...b]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.at - x.at).slice(0, CAP);
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  events: [],
  async hydrate() {
    try {
      await migrateLegacy();
    } catch {
      // keep the legacy feed in localStorage and retry next launch
    }
    const loaded = await listActivity(CAP).catch(() => []);
    // Events that streamed in while loading are kept, not clobbered.
    set({ events: merge(get().events, loaded) });
  },
  receive(event) {
    set({ events: merge([event], get().events) });
  },
  log(input) {
    void recordActivity({ actor: "user", ...input })
      .then((event) => get().receive(event))
      .catch(() => {
        // best-effort: a failed log write never blocks the action it describes
      });
  },
  clear() {
    set({ events: [] });
    void clearActivity().catch(() => {});
  },
}));

// Imperative helper for non-component call sites (stores, async handlers).
export const activity = {
  log: (input: ActivityInput) => useActivityStore.getState().log(input),
};
