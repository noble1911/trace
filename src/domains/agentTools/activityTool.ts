import type Anthropic from "@anthropic-ai/sdk";
import { listActivity } from "@/ipc/activity";
import {
  activityLine,
  DEFAULT_LIMIT,
  filterActivity,
  MAX_LIMIT,
  parseSince,
} from "./activityFilter";
import { int, str } from "./args";
import { findSession } from "./sessionTools";

// Recent events from trace's activity log (the Activity page): tickets moved,
// agents started and stopped, PRs raised and merged, checks, scheduled runs.
// Read-only.

/** How far back the log is read; the filters pick from these. */
const SCAN = 5_000;

export const READ_ACTIVITY: Anthropic.Tool = {
  name: "read_activity",
  description: `Read recent events from trace's activity log, newest first: tickets moved, agents started, interrupted, stopped or waiting on the user, sessions created, PRs raised and merged, CI checks passing or failing, scheduled runs, repos added. Each line has the time (UTC), kind, who did it (user, agent, orchestrator, schedule, system), the ticket or session, and what happened. Filter by since, kind, session or ticket; at most ${MAX_LIMIT} events (default ${DEFAULT_LIMIT}). Per-turn "agent-turn-end" events are left out unless asked for by kind. Read-only.`,
  input_schema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          'Only events after this: an ISO time ("2026-11-07T09:00:00Z") or a span ("last 2h", "30m", "3 days").',
      },
      kind: {
        type: "string",
        description:
          'Only these kinds, comma-separated, e.g. "pr-raised,checks-failed". Kinds: transition, agent-start, agent-needs-input, agent-turn-end, agent-exit, agent-interrupted, agent-stopped, session-created, session-archived, pr-raised, pr-merged, checks-failed, checks-passed, schedule-run-started, schedule-run-succeeded, schedule-run-failed, workspace-removed, repo-added, page-opened, images-shown.',
      },
      session_id: {
        type: "string",
        description:
          "Only this session's events (and its companion agents'): its id or exact title.",
      },
      ticket: { type: "string", description: "Only this ticket's events, by key (e.g. ENG-12)." },
      limit: {
        type: "number",
        description: `How many events at most (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
      },
    },
    required: [],
  },
};

/** Run read_activity. */
export async function runReadActivity(input: unknown, now = Date.now()): Promise<string> {
  const sinceText = str(input, "since");
  const since = sinceText ? parseSince(sinceText, now) : undefined;
  const limit = int(input, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const kinds = str(input, "kind")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const ref = str(input, "session_id");
  const session = ref ? findSession(ref) : null;
  const workspaces = session ? [session.id, ...(session.agents ?? []).map((a) => a.id)] : [];
  const ticket = str(input, "ticket") || undefined;
  const events = filterActivity(await listActivity(SCAN), {
    since,
    kinds,
    workspaces,
    ticket,
    limit,
  });
  if (events.length === 0) return "No activity matches.";
  const more =
    events.length === limit
      ? `\n(${limit} shown; narrow it with since or kind, or raise limit.)`
      : "";
  return `${events.map(activityLine).join("\n")}${more}`;
}
