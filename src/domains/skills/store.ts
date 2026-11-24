import { create } from "zustand";
import {
  addSkillSource,
  type Installs,
  readSkillSource,
  removeSkillSource,
  type SourceRecord,
  type SourceView,
  skillInstalls,
  skillSources,
} from "@/ipc/skills";

// Integrations → Skills: the sources the user added, what each holds as last read
// from GitHub, and what Claude Code has installed. All read again each time the tab
// opens (and the installs after every install, update or removal), never kept.

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
  /** What's installed where; null until read. */
  installs: Installs | null;
  /** Why the installs couldn't be read (Claude Code missing, say). */
  installsError: string | null;
  /** Load the list and read every source, and the installs. */
  load: () => Promise<void>;
  /** Ask Claude Code again what's installed. */
  loadInstalls: () => Promise<void>;
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
  installs: null,
  installsError: null,

  async load() {
    const installs = get().loadInstalls();
    const sources = await skillSources();
    set({ sources });
    await Promise.all([installs, ...sources.map((s) => get().refresh(s.repo))]);
  },

  async loadInstalls() {
    try {
      set({ installs: await skillInstalls(), installsError: null });
    } catch (err) {
      set({ installsError: String(err) });
    }
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
