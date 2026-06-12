import { create } from "zustand";
import { activity } from "@/domains/activity/store";
import type { AgentCli } from "@/ipc/agent";
import {
  archiveSession,
  createSession,
  deleteSession,
  linkSessionToIssue,
  listSessionGroups,
  listSessions,
  renameSession,
  saveSessionGroups,
  setSessionGroup,
  unarchiveSession,
} from "@/ipc/session";
import type { ScratchSession, SessionGroups } from "./types";

// Metadata + selection only. Live runtime state (running set, output buffers) is
// keyed by workspace id in the board store, which the app-level pty listeners
// already populate — a session id flows through the exact same machinery.
interface SessionsStore {
  sessions: ScratchSession[];
  /** Tabs + sections (display order). The frontend owns all manipulation. */
  groups: SessionGroups;
  selectedId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  create: (title: string, cli: AgentCli) => Promise<ScratchSession>;
  rename: (id: string, title: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Persist a new tabs/sections structure (optimistic, reconciled on reply). */
  saveGroups: (next: SessionGroups) => Promise<void>;
  /** File a session under a tab/section (optimistic). */
  assign: (id: string, tab: string | null, section: string | null) => Promise<void>;
  /** Bind a session to a Jira issue — the session is consumed by the ticket. */
  linkToIssue: (id: string, issueKey: string) => Promise<void>;
  select: (id: string) => void;
  close: () => void;
}

function patch(
  sessions: ScratchSession[],
  id: string,
  archivedAt: number | null
): ScratchSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, archivedAt } : s));
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: [],
  groups: { tabs: [], sections: [] },
  selectedId: null,
  loaded: false,
  async load() {
    const [sessions, groups] = await Promise.all([listSessions(), listSessionGroups()]);
    set({ sessions, groups, loaded: true });
  },
  async create(title, cli) {
    const session = await createSession(title, cli);
    set((s) => ({ sessions: [session, ...s.sessions], selectedId: session.id }));
    activity.log({ kind: "session-created", title: `created session “${session.title}”` });
    return session;
  },
  async rename(id, title) {
    const updated = await renameSession(id, title);
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }));
  },
  async archive(id) {
    await archiveSession(id);
    set((s) => ({
      sessions: patch(s.sessions, id, Math.floor(Date.now() / 1000)),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
  async unarchive(id) {
    await unarchiveSession(id);
    set((s) => ({ sessions: patch(s.sessions, id, null) }));
  },
  async remove(id) {
    await deleteSession(id);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
  async saveGroups(next) {
    set({ groups: next });
    // The backend sanitizes (trims names, re-homes orphaned sections) —
    // adopt its version so the UI never drifts from disk.
    const saved = await saveSessionGroups(next);
    set({ groups: saved });
  },
  async assign(id, tab, section) {
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, tab, section } : x)),
    }));
    const updated = await setSessionGroup(id, tab, section);
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }));
  },
  async linkToIssue(id, issueKey) {
    await linkSessionToIssue(id, issueKey);
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    activity.log({ kind: "session-created", issueKey, title: `session linked to ${issueKey}` });
  },
  select(id) {
    set({ selectedId: id });
  },
  close() {
    set({ selectedId: null });
  },
}));
