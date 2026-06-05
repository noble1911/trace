import { create } from "zustand";
import { toast } from "@/app/toast";
import { activity } from "@/domains/activity/store";
import type { BoardData, ColumnStatus, PullRequest } from "@/domains/jira/types";
import { getIssuePullRequests, getJiraBoard, transitionJiraIssue } from "@/ipc/jira";

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

interface BoardStore {
  boardId: number | null;
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
  /** GitHub PRs linked to each issue, keyed by issue key. */
  pullRequests: Record<string, PullRequest[]>;
  /**
   * Raw PTY output chunks (base64) captured per workspace_id since the app
   * started listening. App-level capture keeps the stream flowing even when the
   * terminal isn't mounted; the live terminal in `terminalRegistry` drains new
   * chunks from here as they arrive.
   */
  outputBuffers: Record<string, string[]>;

  loadBoard: (boardId: number) => Promise<void>;
  refresh: () => Promise<void>;
  moveIssue: (key: string, status: ColumnStatus) => Promise<void>;
  openIssue: (key: string) => void;
  closeIssue: () => void;
  setFilter: (filter: BoardFilter) => void;
  setAssigneeFilter: (accountId: string | null) => void;
  setAgentRunning: (key: string, running: boolean) => void;
  appendOutput: (workspaceId: string, chunk: string) => void;
  clearOutput: (workspaceId: string) => void;
  /** Re-fetch PRs for one issue (after raise / merge). */
  refreshIssuePrs: (issueKey: string, issueId: string) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boardId: null,
  data: null,
  loading: false,
  error: null,
  filter: loadFilter(),
  assigneeFilter: loadAssigneeFilter(),
  selectedIssueKey: null,
  runningAgents: new Set(),
  pullRequests: {},
  outputBuffers: {},

  async loadBoard(boardId) {
    set({ boardId, loading: true, error: null, pullRequests: {} });
    try {
      const data = await getJiraBoard(boardId);
      set({ data, loading: false });
      // Fan out PR lookups in the background — cards render immediately and pop
      // a badge in as each issue's dev-status response lands. Failures are silent
      // (no GitHub-for-Jira integration → no badge, not an error).
      for (const issue of data.issues) {
        getIssuePullRequests(issue.id)
          .then((prs) => {
            if (prs.length === 0) return;
            set((s) => ({ pullRequests: { ...s.pullRequests, [issue.key]: prs } }));
          })
          .catch(() => {});
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  async refresh() {
    const { boardId } = get();
    if (boardId != null) await get().loadBoard(boardId);
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
      await transitionJiraIssue(key, [status.id]);
      await get().refresh();
      toast.success(`Moved ${key} to ${status.name}`);
      activity.log({ kind: "transition", issueKey: key, title: `→ ${status.name}` });
    } catch (err) {
      // Roll the card back and surface *why* — Jira workflows don't permit every
      // status→status jump, and a silent revert reads as "transitions are broken".
      const current = get().data;
      if (current) set({ data: { ...current, issues: snapshot } });
      toast.error(formatMoveError(err));
    }
  },

  openIssue(key) {
    set({ selectedIssueKey: key });
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
    set({ runningAgents: next });
  },
  appendOutput(workspaceId, chunk) {
    set((s) => {
      const prev = s.outputBuffers[workspaceId] ?? [];
      return {
        outputBuffers: { ...s.outputBuffers, [workspaceId]: [...prev, chunk] },
      };
    });
  },
  clearOutput(workspaceId) {
    set((s) => {
      const next = { ...s.outputBuffers };
      delete next[workspaceId];
      return { outputBuffers: next };
    });
  },
  async refreshIssuePrs(issueKey, issueId) {
    try {
      const prs = await getIssuePullRequests(issueId);
      set((s) => ({ pullRequests: { ...s.pullRequests, [issueKey]: prs } }));
    } catch {
      // Silent — dev-status unavailability isn't worth surfacing here.
    }
  },
}));
