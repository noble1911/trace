import type { AgentLight } from "@/domains/live/types";
import { agoLabel, compactCount, type SessionStats } from "./sessionStats.ts";

// The sessions part of the orchestrator's CURRENT BOARD STATE, as terse text.
// Pure: every number comes from computeSessionStats, so the model narrates
// counts and never makes them up.

/** How many sessions the snapshot lists one by one before summarising the rest. */
const LIST_CAP = 40;

const WORD: Record<AgentLight, string> = {
  attention: "needs you",
  working: "working",
  ready: "ready",
  stopped: "stopped",
};

function oneLine(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function usageLine(stats: SessionStats): string {
  const c = stats.chat;
  if (c.turns === 0) return "CHAT AGENTS: no chat-agent turns recorded";
  const cost = c.costUsd === null ? "" : ` · $${c.costUsd.toFixed(2)} cost`;
  return (
    `CHAT AGENTS: ${c.agents} with turns · ${c.turns} turns · ${compactCount(c.inputTokens)} in · ` +
    `${compactCount(c.outputTokens)} out · ${compactCount(c.cachedTokens)} cached${cost}`
  );
}

/** The sessions block of the snapshot, one line per fact. */
export function sessionSnapshotLines(stats: SessionStats, now: number): string[] {
  if (stats.total === 0) {
    return [
      `SESSIONS: none active${stats.archived ? ` (${stats.archived} archived)` : ""} — start one with start_session or from the Sessions page.`,
    ];
  }
  const a = stats.agents;
  const p = stats.prs;
  const repos = stats.repos.map((r) => `${r.name} (${r.sessions})`).join(", ");
  const unchecked = stats.prsUnchecked
    ? ` · ${stats.prsUnchecked} session(s) not checked for a PR yet`
    : "";
  const lines = [
    `SESSIONS: ${stats.total} active · ${stats.archived} archived · by repo: ${repos}`,
    `SESSION AGENTS: ${a.total} — ${a.working} working · ${a.needsYou} need you · ${a.ready} ready · ${a.stopped} stopped`,
    `SESSION PRS: ${p.open} open · ${p.draft} draft · ${p.merged} merged · ${p.closed} closed${unchecked}`,
    usageLine(stats),
    `SESSIONS LAST 7 DAYS: ${stats.last7d.created} created · ${stats.last7d.turnsEnded} agent turns ended · ${stats.last7d.askedForInput} asks for input`,
  ];
  if (stats.flags.length) lines.push(`SESSION FLAGS: ${stats.flags.join("; ")}`);

  lines.push("", "SESSION LIST (most recently active first; use the id with read tools):");
  for (const row of stats.rows.slice(0, LIST_CAP)) {
    // A companion is addressed by its own id; the first agent by the session id.
    const agents = row.agents
      .map((ag, i) => `${ag.cli}${i === 0 ? "" : ` (id ${ag.workspaceId})`}=${WORD[ag.light]}`)
      .join(", ");
    const branch = row.branch ? ` · ${row.branch}` : "";
    const pr = row.pr ? ` · PR#${row.pr.number}(${row.pr.state})` : "";
    const by = row.startedBy ? ` · started by ${row.startedBy}` : "";
    lines.push(
      `- ${row.id} "${oneLine(row.title, 60)}" · ${row.repo}${branch} · ${agents}${pr}${by} · active ${agoLabel(row.lastActiveAt, now)} ago`
    );
  }
  if (stats.rows.length > LIST_CAP) {
    lines.push(`- … and ${stats.rows.length - LIST_CAP} more, less recently active`);
  }

  if (stats.recent.length) {
    lines.push("", "RECENT SESSION ACTIVITY (newest first):");
    for (const e of stats.recent) {
      const who = e.subject ? `"${oneLine(e.subject, 40)}" ` : "";
      lines.push(`- ${agoLabel(e.at, now)} ago ${who}${oneLine(e.title, 80)} [${e.kind}]`);
    }
  }
  return lines;
}

/** What the snapshot says in place of the board when none is shown: no tracker, or a
 * page with no board on it (Boards with none made yet), while other boards can exist. */
export const NO_BOARD_LINES = [
  "BOARD: none shown in trace right now, so this snapshot has no tickets, columns or sprint. Answer from the sessions below.",
  "Other boards may still exist: list_boards and get_board (where you have them) list and read any board. Act only on a ticket you have read from one; with no boards at all, say ticket actions need a board rather than trying them.",
];

/** The system-prompt rule both orchestrator transports share about sessions. */
export const SESSIONS_RULE =
  "trace also runs standalone SESSIONS — agents not tied to a ticket — and CURRENT BOARD STATE lists them with each agent's state, repo, branch and PR. When its BOARD line says none is shown there are no tickets in it: answer questions about agents and work from the sessions, and act on a ticket only once you've read it from a board (list_boards and get_board, where you have them); with no boards at all, say plainly that ticket actions need one rather than attempting them.";
