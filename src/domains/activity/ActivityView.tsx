import { type ReactNode, useMemo } from "react";
import { I, ICON_SIZE } from "@/components/Icon";
import { InlineConfirm } from "@/components/InlineConfirm";
import { openIssueAnywhere } from "@/domains/board/openIssueAnywhere";
import { useActivityStore } from "./store";
import type { ActivityEvent, ActivityKind } from "./types";

type IconFn = (p: { size?: number }) => ReactNode;

const ICON: Record<ActivityKind, IconFn> = {
  transition: I.Activity,
  "agent-start": I.Play,
  "pr-raised": I.GitPR,
  "pr-merged": I.GitMerge,
  "session-created": I.Sparkles,
  "agent-needs-input": I.Chat,
  "agent-turn-end": I.Terminal,
  "agent-exit": I.Terminal,
  "schedule-run-started": I.Clock,
  "schedule-run-succeeded": I.Clock,
  "schedule-run-failed": I.X,
  "checks-failed": I.X,
  "checks-passed": I.Beaker,
  "workspace-removed": I.Archive,
  "agent-interrupted": I.Terminal,
  "agent-stopped": I.Terminal,
  "session-archived": I.Archive,
  "repo-added": I.Folder,
  "page-opened": I.Globe,
  "images-shown": I.Images,
  other: I.Activity,
};

// Design timeline class per kind: merge=green, pr=violet, spawn=amber, fail=red.
const ROW_CLASS: Partial<Record<ActivityKind, string>> = {
  "agent-start": "spawn",
  "session-created": "spawn",
  "schedule-run-started": "spawn",
  "agent-needs-input": "spawn",
  "pr-raised": "pr",
  "pr-merged": "merge",
  "checks-passed": "merge",
  "schedule-run-succeeded": "merge",
  "checks-failed": "fail",
  "schedule-run-failed": "fail",
};

// Logged for consumers that react to agents (one per turn — far too chatty for
// a timeline a person reads).
const HIDDEN: ReadonlySet<ActivityKind> = new Set(["agent-turn-end"]);

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Events interleaved with day headers (events arrive newest-first). */
function withDayHeaders(events: ActivityEvent[]): (ActivityEvent | { day: string })[] {
  const out: (ActivityEvent | { day: string })[] = [];
  let last = "";
  for (const e of events) {
    const day = dayLabel(e.at);
    if (day !== last) {
      out.push({ day });
      last = day;
    }
    out.push(e);
  }
  return out;
}

// The "Activity" view — a day-grouped timeline of board/agent events.
export function ActivityView() {
  const all = useActivityStore((s) => s.events);
  const events = useMemo(() => all.filter((e) => !HIDDEN.has(e.kind)), [all]);
  const clear = useActivityStore((s) => s.clear);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <div className="desc">Transitions, agents, scheduled runs, pull requests and CI.</div>
        </div>
        {events.length > 0 && (
          <div className="right">
            <InlineConfirm
              label="Clear"
              message="Delete the whole activity log? This can't be undone."
              confirmLabel="Clear"
              onConfirm={clear}
            />
          </div>
        )}
      </div>
      <div className="page-body">
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Activity size={ICON_SIZE.empty} />
              </span>
              <div className="title">No activity yet</div>
              <div className="hint">
                Move a card, start an agent, or raise a PR and it'll show up here.
              </div>
            </div>
          </div>
        ) : (
          <div className="activity">
            {withDayHeaders(events).map((row) =>
              "day" in row ? (
                <div key={row.day} className="activity-day">
                  {row.day}
                </div>
              ) : (
                <ActivityRow key={row.id} event={row} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Ico = ICON[event.kind] ?? I.Activity;
  const clickable = Boolean(event.issueKey);
  const open = () => {
    if (event.issueKey) void openIssueAnywhere(event.issueKey);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: timeline row; only issue-linked rows are interactive
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer affordance only — the board offers the keyboard path
    <div
      className={`act-row ${ROW_CLASS[event.kind] ?? ""}${clickable ? " click" : ""}`}
      onClick={clickable ? open : undefined}
    >
      <span className="time">{timeLabel(event.at)}</span>
      <span className="ic">
        <Ico size={12} />
      </span>
      <div className="body">
        {event.issueKey ? (
          <span className="ticket">{event.issueKey}</span>
        ) : (
          event.subject && <span className="ticket">{event.subject}</span>
        )}
        {event.title}
      </div>
    </div>
  );
}
