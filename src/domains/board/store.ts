import { create } from "zustand";
import { toast } from "@/app/toast";
import { activity } from "@/domains/activity/store";
import { autoStartOnMove } from "@/domains/agent/defaults";
import { boardOptionFor } from "@/domains/issues/store";
import type { BoardData, ColumnStatus, ProviderKind, PullRequest } from "@/domains/issues/types";
import { useSessionsStore } from "@/domains/sessions/store";
import { getBoard, getIssuePullRequests, transitionIssue } from "@/ipc/issues";
import { isStartOfWork } from "./columns";
import { armWaitingNotify, cancelWaitingWatch, watchForQuiet } from "./waitingNotify";

// Tauri command errors arrive as strings; trim noise so the toast reads cleanly.
function formatMoveError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error:\s*/i, "").trim() || "Couldn't move the issue.";
}

export type BoardFilter = "all" | "active" | "running";

const FILTER_KEY = "trace.boardFilter";
const ASSIGNEE_KEY = "trace.assigneeFilter";

function loadFilter(): BoardFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === "active" || v === "running" ? v : "all";
  } catch {
    return "all";
  }
}

// `undefined` = never chosen (defaults to me), `null` = all, string = an account.
function loadAssigneeFilter(): string | null | undefined {
  try {
    const v = localStorage.getItem(ASSIGNEE_KEY);
    if (v === null) return undefined;
    return v === "all" ? null : v;
  } catch {
    return undefined;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

/** Live state of an issue's agent. */
export type SessionStatus = "idle" | "working" | "waiting";

/** One PTY output chunk: base64 bytes + the backend's monotonic counter. */
export interface OutputChunk {
  seq: number;
  data: string;
}

/** Derive a session's status from the running set + activity flag. */
export function statusOf(
  running: boolean,
  activity: "working" | "waiting" | undefined
): SessionStatus {
  if (!running) return "idle";
  return activity ?? "working";
}

interface BoardStore {
  /** The loaded board's switcher key (`${provider}:${boardId}`). */
  boardKey: string | null;
  /** Provider of the loaded board — transitions and PR lookups route through it. */
  provider: ProviderKind | null;
  data: BoardData | null;
  loading: boolean;
  error: string | null;
  filter: BoardFilter;
  /**
   * Assignee filter: `undefined` = not chosen yet (defaults to the current user),
   * `null` = all assignees, a string = that assignee's accountId.
   */
  assigneeFilter: string | null | undefined;

  selectedIssueKey: string | null;
  /** Issue keys with a live Claude PTY session. */
  runningAgents: Set<string>;
  /** For running agents: whether they're actively generating or awaiting input. */
  agentActivity: Record<string, "working" | "waiting">;
  /**
   * Waiting sessions the user has already looked at — excluded from the rail
   * and Dock badges until they give the agent more work. Viewing a session is
   * the acknowledgement; replying isn't required to clear the flag. Only
   * `noteUserTurn` clears it: an idle TUI repaints itself, so "the agent
   * produced bytes" is not evidence of anything new to look at.
   */
  ackedWaiting: Set<string>;
  ackWaiting: (key: string) => void;
  /**
   * The user just gave a workspace work — typed into its terminal, sent it an
   * orchestrator message, or started it. Re-arms its waiting notification and
   * drops the acknowledgement so the finished turn counts as news again.
   */
  noteUserTurn: (workspaceId: string) => void;
  /** Flip a running agent's activity to "waiting" (the quiet timer's callback). */
  markWaiting: (workspaceId: string) => void;
  /** GitHub PRs linked to each issue, keyed by issue key. */
  pullRequests: Record<string, PullRequest[]>;
  /**
   * Raw PTY output chunks (base64 + backend seq) captured per workspace_id
   * since the app started listening. App-level capture keeps the stream
   * flowing even when the terminal isn't mounted; the live terminal in
   * `terminalRegistry` drains new chunks from here as they arrive, using seq
   * to avoid re-writing what a history snapshot already replayed.
   */
  outputBuffers: Record<string, OutputChunk[]>;

  loadBoard: (boardKey: string) => Promise<void>;
  refresh: () => Promise<void>;
  moveIssue: (key: string, status: ColumnStatus) => Promise<void>;
  openIssue: (key: string) => void;
  closeIssue: () => void;
  setFilter: (filter: BoardFilter) => void;
  setAssigneeFilter: (accountId: string | null) => void;
  /** Start an agent on an issue with the templated kickoff brief. */
  kickoff: (key: string) => void;
  /** Issue awaiting a repo pick before its kickoff can proceed. */
  repoPickFor: string | null;
  closeRepoPick: () => void;
  setAgentRunning: (key: string, running: boolean) => void;
  appendOutput: (workspaceId: string, data: string, seq: number) => void;
  clearOutput: (workspaceId: string) => void;
  /** Re-fetch PRs for one issue (after raise / merge). */
  refreshIssuePrs: (issueKey: string, issueId: string) => Promise<void>;
  /** Re-fetch PRs for every issue (window focus, periodic catch-up). */
  refreshAllPrs: () => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boardKey: null,
  provider: null,
  data: null,
  loading: false,
  error: null,
  filter: loadFilter(),
  assigneeFilter: loadAssigneeFilter(),
  selectedIssueKey: null,
  runningAgents: new Set(),
  agentActivity: {},
  ackedWaiting: new Set(),
  pullRequests: {},
  outputBuffers: {},

  async loadBoard(boardKey) {
    const option = boardOptionFor(boardKey);
    if (!option) return;
    set({ boardKey, provider: option.provider, loading: true, error: null, pullRequests: {} });
    try {
      const data = await getBoard(option.provider, option.boardId);
      set({ data, loading: false });
      // Fan out PR lookups in the background — cards render immediately and pop
      // a badge in as each issue's dev-status response lands. Failures are silent
      // (no GitHub-for-Jira integration → no badge, not an error). Only Jira has
      // a dev-status integration; other providers would all return empty.
      if (option.provider === "jira") {
        for (const issue of data.issues) {
          getIssuePullRequests(option.provider, issue.id)
            .then((prs) => {
              if (prs.length === 0) return;
              set((s) => ({ pullRequests: { ...s.pullRequests, [issue.key]: prs } }));
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  async refresh() {
    const { boardKey } = get();
    if (boardKey != null) await get().loadBoard(boardKey);
  },

  async moveIssue(key, status) {
    const { data } = get();
    if (!data) return;

    // Optimistically move the card to the *specific* target status — a column can
    // hold several (In Progress + Blocked), so we transition to the exact one the
    // card was dropped onto, not just "any status in this column".
    const snapshot = data.issues;
    set({
      data: {
        ...data,
        issues: data.issues.map((i) => (i.key === key ? { ...i, statusId: status.id } : i)),
      },
    });

    try {
      const provider = get().provider;
      if (!provider) return;
      await transitionIssue(provider, key, [status.id]);
      await get().refresh();
      toast.success(`Moved ${key} to ${status.name}`);
      activity.log({ kind: "transition", issueKey: key, title: `→ ${status.name}` });
      // Landing in the board's first in-progress column can start the work
      // automatically — opt-in via Settings (spawning agents costs tokens).
      if (
        autoStartOnMove() &&
        isStartOfWork(data.columns, status.id) &&
        !get().runningAgents.has(key)
      ) {
        get().kickoff(key);
      }
    } catch (err) {
      // Roll the card back and surface *why* — Jira workflows don't permit every
      // status→status jump, and a silent revert reads as "transitions are broken".
      const current = get().data;
      if (current) set({ data: { ...current, issues: snapshot } });
      toast.error(formatMoveError(err));
      // The snapshot predates any move that raced this one, so reconcile with
      // Jira rather than trusting it as the final state.
      await get().refresh();
    }
  },

  repoPickFor: null,
  closeRepoPick() {
    set({ repoPickFor: null });
  },
  kickoff(key) {
    const issue = get().data?.issues.find((i) => i.key === key);
    if (!issue || get().runningAgents.has(key)) return;
    // Fire-and-forget — worktree creation takes seconds and the board
    // shouldn't block on it. (Dynamic import: launch.ts imports this store,
    // so a static import would be a cycle.)
    void import("@/domains/agent/launch").then(async ({ launchIssueAgent, kickoffPrompt }) =>
      launchIssueAgent(key, { prompt: await kickoffPrompt(issue) })
        .then(() => toast.success(`Started agent on ${key}`))
        .catch((err) => {
          // Unassigned issue in a multi-repo setup: ask right here on the
          // board instead of dead-ending — picking retries the kickoff.
          if (String(err).includes("No repository assigned")) {
            set({ repoPickFor: key });
          } else {
            toast.error(`Agent didn't start: ${formatMoveError(err)}`);
          }
        })
    );
  },
  openIssue(key) {
    // The issue detail and a session detail are both full-screen overlays, so
    // only one may be open — opening an issue dismisses any open session (else
    // both render stacked, e.g. a board-agent notification firing mid-session).
    useSessionsStore.getState().close();
    set({ selectedIssueKey: key });
  },
  ackWaiting(key) {
    set((s) => {
      if (s.ackedWaiting.has(key)) return {};
      const next = new Set(s.ackedWaiting);
      next.add(key);
      return { ackedWaiting: next };
    });
  },
  noteUserTurn(workspaceId) {
    armWaitingNotify(workspaceId);
    // Called on every keystroke, so skip the store write unless it changes
    // something — a no-op `set` still wakes every subscriber.
    if (!get().ackedWaiting.has(workspaceId)) return;
    set((s) => {
      const next = new Set(s.ackedWaiting);
      next.delete(workspaceId);
      return { ackedWaiting: next };
    });
  },
  markWaiting(workspaceId) {
    set((s) => {
      if (!s.runningAgents.has(workspaceId)) return {};
      return { agentActivity: { ...s.agentActivity, [workspaceId]: "waiting" } };
    });
  },
  closeIssue() {
    set({ selectedIssueKey: null });
  },
  setFilter(filter) {
    persist(FILTER_KEY, filter);
    set({ filter });
  },
  setAssigneeFilter(accountId) {
    persist(ASSIGNEE_KEY, accountId ?? "all");
    set({ assigneeFilter: accountId });
  },
  setAgentRunning(key, running) {
    const next = new Set(get().runningAgents);
    if (running) next.add(key);
    else next.delete(key);
    set((s) => {
      const agentActivity = { ...s.agentActivity };
      const ackedWaiting = new Set(s.ackedWaiting);
      if (running) {
        // Just started — treat as working until output settles. Launching is the
        // user's turn, so the first finished turn is worth a notification.
        agentActivity[key] = "working";
        ackedWaiting.delete(key);
        armWaitingNotify(key);
      } else {
        // Stopped/exited — clear any activity and its pending timers.
        delete agentActivity[key];
        ackedWaiting.delete(key);
        cancelWaitingWatch(key);
      }
      return { runningAgents: next, agentActivity, ackedWaiting };
    });
  },
  appendOutput(workspaceId, data, seq) {
    set((s) => {
      const prev = s.outputBuffers[workspaceId] ?? [];
      const out: Partial<BoardStore> = {
        outputBuffers: { ...s.outputBuffers, [workspaceId]: [...prev, { seq, data }] },
      };
      // Output means the agent is generating — mark it working; `watchForQuiet`
      // decides when the turn is over. Note that output deliberately does NOT
      // clear `ackedWaiting` or arm a notification: a repainting idle TUI emits
      // bytes too, and only the user starting a new turn is real news.
      if (s.agentActivity[workspaceId] !== "working") {
        out.agentActivity = { ...s.agentActivity, [workspaceId]: "working" };
      }
      return out;
    });
    watchForQuiet(workspaceId);
  },
  clearOutput(workspaceId) {
    set((s) => {
      const next = { ...s.outputBuffers };
      delete next[workspaceId];
      return { outputBuffers: next };
    });
  },
  async refreshIssuePrs(issueKey, issueId) {
    const { provider } = get();
    if (provider !== "jira") return;
    try {
      // Targeted refresh → bust Jira's cache; this is the path that runs
      // right after something changed the PR's state.
      const prs = await getIssuePullRequests(provider, issueId, true);
      set((s) => ({ pullRequests: { ...s.pullRequests, [issueKey]: prs } }));
    } catch {
      // Silent — dev-status unavailability isn't worth surfacing here.
    }
  },
  refreshAllPrs() {
    const { data, pullRequests, provider } = get();
    if (!data) return;
    // Only Jira has linked-PR data to refresh.
    if (provider !== "jira") return;
    for (const issue of data.issues) {
      // Cache-bust only issues whose known PRs are still in a live state —
      // those are the ones Jira's cache can hold wrong in a way that matters.
      // Merged/declined are final; issues with no PRs stay on the cheap path.
      const fresh =
        pullRequests[issue.key]?.some((pr) => pr.state !== "merged" && pr.state !== "declined") ??
        false;
      getIssuePullRequests("jira", issue.id, fresh)
        .then((prs) => {
          set((s) => {
            // Skip no-op updates, but do clear an entry whose PRs vanished.
            if (prs.length === 0 && !s.pullRequests[issue.key]) return {};
            return { pullRequests: { ...s.pullRequests, [issue.key]: prs } };
          });
        })
        .catch(() => {});
    }
  },
}));
