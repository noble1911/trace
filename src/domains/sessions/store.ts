import { create } from "zustand";
import { activity } from "@/domains/activity/store";
import type { AgentCli } from "@/ipc/agent";
import { createSession, deleteSession, listSessions } from "@/ipc/session";
import type { ScratchSession } from "./types";

// Metadata + selection only. Live runtime state (running set, output buffers) is
// keyed by workspace id in the board store, which the app-level pty listeners
// already populate — a session id flows through the exact same machinery.
interface SessionsStore {
  sessions: ScratchSession[];
  selectedId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  create: (title: string, cli: AgentCli) => Promise<ScratchSession>;
  remove: (id: string) => Promise<void>;
  select: (id: string) => void;
  close: () => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: [],
  selectedId: null,
  loaded: false,
  async load() {
    const sessions = await listSessions();
    set({ sessions, loaded: true });
  },
  async create(title, cli) {
    const session = await createSession(title, cli);
    set((s) => ({ sessions: [session, ...s.sessions], selectedId: session.id }));
    activity.log({ kind: "session-created", title: `created session “${session.title}”` });
    return session;
  },
  async remove(id) {
    await deleteSession(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
  select(id) {
    set({ selectedId: id });
  },
  close() {
    set({ selectedId: null });
  },
}));
