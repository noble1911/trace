import { create } from "zustand";
import type { PrEntry, PrThread } from "@/ipc/prWatch";

// The PRs each workspace raised, and their live discussion, polled by
// `usePrWatch`. Also remembers what the user has already seen of each PR, so a
// comment that's edited in place (bots do this constantly) or gains a reply is
// flagged instead of silently changing. "Seen" is session-only on purpose: after
// a relaunch everything starts read, which beats a wall of stale flags.

/** What makes an entry "changed": its latest activity and reply count. */
export function entrySignature(e: PrEntry): string {
  return `${e.activityAt}|${e.replies.length}`;
}

export type EntryFlag = "new" | "updated" | null;

interface PrWatchState {
  /** workspaceId → PR URLs discovered for it. */
  links: Record<string, string[]>;
  /** PR URL → latest fetch. */
  threads: Record<string, PrThread>;
  /** PR URL → last fetch error (cleared by a successful fetch). */
  errors: Record<string, string>;
  /** PR URL → entry id → signature the user has seen. */
  seen: Record<string, Record<string, string>>;
  setLinks: (workspaceId: string, urls: string[]) => void;
  setThread: (url: string, thread: PrThread) => void;
  setError: (url: string, error: string) => void;
  /** Mark entries (default: all) of a PR as seen at their current state. */
  markSeen: (url: string, ids?: string[]) => void;
}

const snapshot = (entries: PrEntry[]) =>
  Object.fromEntries(entries.map((e) => [e.id, entrySignature(e)]));

export const usePrWatchStore = create<PrWatchState>((set, get) => ({
  links: {},
  threads: {},
  errors: {},
  seen: {},
  setLinks: (workspaceId, urls) => {
    const prev = get().links[workspaceId];
    if (prev && prev.join("\n") === urls.join("\n")) return;
    set((s) => ({ links: { ...s.links, [workspaceId]: urls } }));
  },
  setThread: (url, thread) =>
    set((s) => {
      const { [url]: _cleared, ...errors } = s.errors;
      // First sight of a PR: everything already on it counts as read.
      const seen = s.seen[url] ? s.seen : { ...s.seen, [url]: snapshot(thread.entries) };
      return { threads: { ...s.threads, [url]: thread }, errors, seen };
    }),
  setError: (url, error) => set((s) => ({ errors: { ...s.errors, [url]: error } })),
  markSeen: (url, ids) =>
    set((s) => {
      const thread = s.threads[url];
      if (!thread) return {};
      const picked = ids ? thread.entries.filter((e) => ids.includes(e.id)) : thread.entries;
      return { seen: { ...s.seen, [url]: { ...s.seen[url], ...snapshot(picked) } } };
    }),
}));

/** Whether an entry is unseen ("new"), changed since seen ("updated"), or neither. */
export function entryFlag(seen: Record<string, string> | undefined, e: PrEntry): EntryFlag {
  if (!seen) return null;
  const was = seen[e.id];
  if (was === undefined) return "new";
  return was === entrySignature(e) ? null : "updated";
}
