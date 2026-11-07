import type { ActivityEvent } from "@/domains/activity/types";
import type { JournalRow } from "@/domains/agentChat/types";
import type { AgentLight } from "@/domains/live/types";
import type { ScratchSession } from "@/domains/sessions/types";
import type { SessionOverview } from "@/ipc/workspace";
import { basename } from "../../platform/paths.ts";

// Deterministic metrics over standalone sessions and their agents — the
// no-board counterpart of stats.ts (and shown beside it when a board is
// loaded). Pure functions over plain state: the orchestrator LLM narrates these
// numbers, never computes them. Runtime imports are relative `.ts` so
// `npm test` (node's own runner) can load this file directly.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SessionStatsInput {
  sessions: ScratchSession[];
  /** Every running workspace id (PTY or chat agent). */
  runningAgents: ReadonlySet<string>;
  /** Each live agent's light (`domains/live`), so counts match Fleet and Inbox. */
  lights: Record<string, AgentLight>;
  /** Branch + PR per session id, when `sessions_overview` has answered. */
  overview: Record<string, SessionOverview>;
  /** Chat agents' journals that are loaded, by workspace id. */
  journals: Record<string, { rows: readonly JournalRow[] }>;
  activity: ActivityEvent[];
  now: number;
}

export interface SessionAgentStat {
  workspaceId: string;
  cli: string;
  light: AgentLight;
}

export interface SessionRowStat {
  id: string;
  title: string;
  repo: string;
  branch: string | null;
  pr: SessionOverview["pr"];
  agents: SessionAgentStat[];
  /** Epoch ms of its newest activity event, or its creation. */
  lastActiveAt: number;
}

export interface LightCounts {
  total: number;
  working: number;
  needsYou: number;
  ready: number;
  stopped: number;
}

export interface ChatUsage {
  /** Agents with a chat journal holding at least one turn. */
  agents: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** Cache reads, shown apart from fresh input as the chat view does. */
  cachedTokens: number;
  /** Summed over turns that reported a cost; null when none did. */
  costUsd: number | null;
}

export interface SessionStats {
  /** Active (not archived) sessions. */
  total: number;
  archived: number;
  /** Every agent on an active session, primary and companions. */
  agents: LightCounts;
  /** Active sessions per repo (or folder), most first. */
  repos: { name: string; sessions: number }[];
  prs: { open: number; draft: number; merged: number; closed: number };
  /** Active sessions whose branch/PR hasn't been checked yet. */
  prsUnchecked: number;
  chat: ChatUsage;
  /** Counts over the last 7 days, from the activity log and session records. */
  last7d: { created: number; turnsEnded: number; askedForInput: number };
  /** Active sessions, most recently active first. */
  rows: SessionRowStat[];
  /** Session activity, newest first, without per-turn noise. */
  recent: ActivityEvent[];
  /** Human-readable attention flags, most-actionable first. */
  flags: string[];
}

/** Every agent workspace id on a session — mirrors `agentWorkspaceIds`. */
function rosterOf(s: ScratchSession): { workspaceId: string; cli: string }[] {
  return [
    { workspaceId: s.id, cli: s.cli },
    ...(s.agents ?? []).map((a) => ({ workspaceId: a.id, cli: a.cli })),
  ];
}

/** Where a session runs, as a short name. */
export function sessionRepoName(s: ScratchSession, overview?: SessionOverview): string {
  if (s.folder) return `${basename(s.folder)} (folder)`;
  const repo = overview?.repo || s.repo;
  return repo ? basename(repo) : "default repo";
}

function lightFor(id: string, input: SessionStatsInput): AgentLight {
  if (!input.runningAgents.has(id)) return "stopped";
  return input.lights[id] ?? "ready";
}

function chatUsage(ids: string[], journals: SessionStatsInput["journals"]): ChatUsage {
  const usage: ChatUsage = {
    agents: 0,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: null,
  };
  for (const id of ids) {
    let turns = 0;
    for (const row of journals[id]?.rows ?? []) {
      if (row.body.kind !== "turn") continue;
      turns++;
      const u = row.body.usage;
      if (!u) continue;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cachedTokens += u.cacheReadTokens;
      if (typeof u.costUsd === "number") usage.costUsd = (usage.costUsd ?? 0) + u.costUsd;
    }
    if (turns > 0) usage.agents++;
    usage.turns += turns;
  }
  return usage;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function computeSessionStats(input: SessionStatsInput): SessionStats {
  const active = input.sessions.filter((s) => !s.archivedAt);
  const archived = input.sessions.length - active.length;

  // Which session each agent workspace belongs to, for the activity log.
  const owner = new Map<string, string>();
  for (const s of active) for (const a of rosterOf(s)) owner.set(a.workspaceId, s.id);
  const sessionEvents = input.activity.filter(
    (e) => e.workspaceId != null && owner.has(e.workspaceId)
  );
  const lastEvent = new Map<string, number>();
  for (const e of sessionEvents) {
    const id = owner.get(e.workspaceId ?? "") ?? "";
    lastEvent.set(id, Math.max(lastEvent.get(id) ?? 0, e.at));
  }

  const agents: LightCounts = { total: 0, working: 0, needsYou: 0, ready: 0, stopped: 0 };
  const prs = { open: 0, draft: 0, merged: 0, closed: 0 };
  const repoCounts = new Map<string, number>();
  let prsUnchecked = 0;

  const rows: SessionRowStat[] = active.map((s) => {
    const ov = input.overview[s.id];
    const repo = sessionRepoName(s, ov);
    repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
    if (!ov) prsUnchecked++;
    else if (ov.pr) prs[ov.pr.state]++;
    const roster = rosterOf(s).map((a) => ({ ...a, light: lightFor(a.workspaceId, input) }));
    for (const a of roster) {
      agents.total++;
      if (a.light === "working") agents.working++;
      else if (a.light === "attention") agents.needsYou++;
      else if (a.light === "ready") agents.ready++;
      else agents.stopped++;
    }
    return {
      id: s.id,
      title: s.title,
      repo,
      branch: ov?.branch ?? null,
      pr: ov?.pr ?? null,
      agents: roster,
      lastActiveAt: Math.max(lastEvent.get(s.id) ?? 0, s.createdAt * 1000),
    };
  });
  rows.sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.title.localeCompare(b.title));

  const repos = [...repoCounts.entries()]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  const since = input.now - 7 * DAY_MS;
  const recent7 = sessionEvents.filter((e) => e.at >= since);
  const last7d = {
    created: active.filter((s) => s.createdAt * 1000 >= since).length,
    turnsEnded: recent7.filter((e) => e.kind === "agent-turn-end").length,
    askedForInput: recent7.filter((e) => e.kind === "agent-needs-input").length,
  };

  const flags: string[] = [];
  if (agents.needsYou > 0) {
    flags.push(`${plural(agents.needsYou, "session agent needs", "session agents need")} you`);
  }
  if (prs.open > 0) flags.push(`${plural(prs.open, "session PR", "session PRs")} open`);

  return {
    total: active.length,
    archived,
    agents,
    repos,
    prs,
    prsUnchecked,
    chat: chatUsage([...owner.keys()], input.journals),
    last7d,
    rows,
    recent: [...sessionEvents]
      .sort((a, b) => b.at - a.at)
      .filter((e) => e.kind !== "agent-turn-end")
      .slice(0, 8),
    flags,
  };
}

/** "5m", "3h", "2d" — how long ago `at` was, for the snapshot and the panel. */
export function agoLabel(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** "1.2M", "84k", "512" — a token count, compactly. */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
