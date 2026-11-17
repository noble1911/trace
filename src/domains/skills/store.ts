import { create } from "zustand";
import {
  addSkillSource,
  readSkillSource,
  removeSkillSource,
  type SourceRecord,
  type SourceView,
  skillSources,
} from "@/ipc/skills";

// Integrations → Skills: the sources the user added, and what each holds as last read
// from GitHub. Read again each time the tab opens, so a source's new skills show.

/** A source as last read: its view, still loading, or why it couldn't be read. */
export type SourceState =
  | { status: "loading" }
  | { status: "ready"; view: SourceView }
  | { status: "error"; error: string };

interface SkillsStore {
  /** Null until first loaded. */
  sources: SourceRecord[] | null;
  /** By repo, lower-cased. */
  read: Record<string, SourceState>;
  /** Load the list and read every source. */
  load: () => Promise<void>;
  /** Read one source again. */
  refresh: (repo: string) => Promise<void>;
  /** Add a source; rejects with why it couldn't be. */
  add: (repo: string) => Promise<SourceView>;
  remove: (repo: string) => Promise<void>;
}

const key = (repo: string) => repo.toLowerCase();

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  sources: null,
  read: {},

  async load() {
    const sources = await skillSources();
    set({ sources });
    await Promise.all(sources.map((s) => get().refresh(s.repo)));
  },

  async refresh(repo) {
    const k = key(repo);
    // Keep what's shown while it's read again; "loading" only the first time.
    if (!get().read[k]) set((s) => ({ read: { ...s.read, [k]: { status: "loading" } } }));
    try {
      const view = await readSkillSource(repo);
      set((s) => ({ read: { ...s.read, [k]: { status: "ready", view } } }));
    } catch (err) {
      set((s) => ({ read: { ...s.read, [k]: { status: "error", error: String(err) } } }));
    }
  },

  async add(repo) {
    const { sources, source } = await addSkillSource(repo);
    set((s) => ({
      sources,
      read: { ...s.read, [key(source.repo)]: { status: "ready", view: source } },
    }));
    return source;
  },

  async remove(repo) {
    const sources = await removeSkillSource(repo);
    set((s) => {
      const read = { ...s.read };
      delete read[key(repo)];
      return { sources, read };
    });
  },
}));

/** A source's state by its repo name. */
export function sourceState(read: Record<string, SourceState>, repo: string): SourceState {
  return read[key(repo)] ?? { status: "loading" };
}

import.meta.hot?.accept(() => location.reload());
