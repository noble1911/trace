import { create } from "zustand";
import { activity } from "@/domains/activity/store";
import { disposeTerminal } from "@/domains/agent/terminalRegistry";
import { useBoardStore } from "@/domains/board/store";
import type { AgentCli } from "@/ipc/agent";
import {
  addSessionAgent,
  archiveSession,
  createSession,
  deleteSession,
  linkSessionToIssue,
  listSessionGroups,
  listSessions,
  removeSessionAgent,
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
  /**
   * Workspace id of the agent tab in view inside the open session — its own agent
   * or one of its companions. Lives here rather than in the detail component
   * because "is the user looking at this agent right now?" is what decides
   * whether a finished turn is worth a notification (see `waitingNotify`).
   */
  selectedAgentId: string | null;
  /** Focus one of the open session's agent tabs. */
  selectAgent: (workspaceId: string) => void;
  loaded: boolean;
  load: () => Promise<void>;
  create: (title: string, cli: AgentCli, repo?: string | null) => Promise<ScratchSession>;
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
  /** Add a companion agent (a second CLI) to a session's worktree. */
  addAgent: (id: string, cli: AgentCli) => Promise<ScratchSession>;
  /** Remove a companion agent — kills its PTY and forgets its conversation. */
  removeAgent: (id: string, agentId: string) => Promise<void>;
  select: (id: string) => void;
  close: () => void;
  /** Session ids most-recently opened, newest first (capped, persisted). */
  recent: string[];
}

function patch(
  sessions: ScratchSession[],
  id: string,
  archivedAt: number | null
): ScratchSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, archivedAt } : s));
}

// Recently-opened sessions, persisted to localStorage (client-only state, like
// the board filter) so the Sessions view's Recents sidebar survives restarts.
const RECENT_KEY = "trace.recentSessions";
const RECENT_CAP = 20;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // best-effort persistence
  }
}

/** Move id to the front (most-recent-first), dedupe, cap. */
function pushRecent(prev: string[], id: string): string[] {
  return [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_CAP);
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: [],
  groups: { tabs: [], sections: [] },
  selectedId: null,
  selectedAgentId: null,
  loaded: false,
  recent: loadRecent(),
  async load() {
    const [sessions, groups] = await Promise.all([listSessions(), listSessionGroups()]);
    set({ sessions, groups, loaded: true });
  },
  async create(title, cli, repo) {
    const session = await createSession(title, cli, repo);
    set((s) => {
      const recent = pushRecent(s.recent, session.id);
      saveRecent(recent);
      return {
        sessions: [session, ...s.sessions],
        selectedId: session.id,
        selectedAgentId: session.id,
        recent,
      };
    });
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
      selectedAgentId: s.selectedId === id ? null : s.selectedAgentId,
    }));
  },
  async unarchive(id) {
    await unarchiveSession(id);
    set((s) => ({ sessions: patch(s.sessions, id, null) }));
  },
  async remove(id) {
    await deleteSession(id);
    set((s) => {
      const recent = s.recent.filter((x) => x !== id);
      saveRecent(recent);
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedAgentId: s.selectedId === id ? null : s.selectedAgentId,
        recent,
      };
    });
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
    set((s) => {
      const recent = s.recent.filter((x) => x !== id);
      saveRecent(recent);
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedAgentId: s.selectedId === id ? null : s.selectedAgentId,
        recent,
      };
    });
    activity.log({ kind: "session-created", issueKey, title: `session linked to ${issueKey}` });
  },
  async addAgent(id, cli) {
    const updated = await addSessionAgent(id, cli);
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }));
    activity.log({ kind: "session-created", title: `added a ${cli} agent to “${updated.title}”` });
    return updated;
  },
  async removeAgent(id, agentId) {
    const updated = await removeSessionAgent(id, agentId);
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? updated : x)) }));
    // The PTY is gone backend-side; drop the renderer's mirror of it too.
    useBoardStore.getState().setAgentRunning(agentId, false);
    useBoardStore.getState().clearOutput(agentId);
    disposeTerminal(agentId);
  },
  select(id) {
    // Mirror of board.openIssue — selecting a session dismisses any open issue
    // so the two full-screen overlays can't stack. The board↔sessions import
    // cycle is safe: each store only reads the other inside an action (call
    // time), never during module init.
    useBoardStore.getState().closeIssue();
    set((s) => {
      // Tolerate a companion agent's workspace id (a notification click carries
      // the *agent's* id, not the session's) — open the session that hosts it.
      const owner =
        s.sessions.find((x) => x.id === id) ??
        s.sessions.find((x) => x.agents?.some((a) => a.id === id));
      const sessionId = owner?.id ?? id;
      const recent = pushRecent(s.recent, sessionId);
      saveRecent(recent);
      // Opening by a companion's id focuses that companion's tab — which is what
      // makes clicking its notification land on the agent that pinged you.
      return { selectedId: sessionId, selectedAgentId: id, recent };
    });
  },
  selectAgent(workspaceId) {
    set({ selectedAgentId: workspaceId });
  },
  close() {
    set({ selectedId: null, selectedAgentId: null });
  },
}));
