import type { ReactNode } from "react";
import { I } from "@/components/Icon";
import { type ActivityEvent, type ActivityKind, useActivityStore } from "./store";

const ICON: Record<ActivityKind, (p: { size?: number }) => ReactNode> = {
  transition: I.Activity,
  "agent-start": I.Bolt,
  "pr-raised": I.GitPR,
  "pr-merged": I.Check,
  "session-created": I.Sparkles,
};

function relTime(at: number): string {
  const diff = (Date.now() - at) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// The "Activity" view — a reverse-chronological timeline of board/agent events.
export function ActivityView() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <div className="desc">Recent transitions, agent runs, and pull requests.</div>
        </div>
        {events.length > 0 && (
          <div className="right">
            <button type="button" className="btn ghost" onClick={clear} title="Clear activity">
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="page-body">
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Activity size={28} />
              </span>
              <div className="title">No activity yet</div>
              <div className="hint">
                Move a card, start an agent, or raise a PR and it'll show up here.
              </div>
            </div>
          </div>
        ) : (
          <div className="activity-list">
            {events.map((e) => (
              <ActivityRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Ico = ICON[event.kind];
  return (
    <div className="activity-row">
      <span className={`activity-ic ${event.kind}`}>
        <Ico size={13} />
      </span>
      <span className="activity-text">
        {event.issueKey && <span className="activity-key">{event.issueKey}</span>}
        {event.title}
      </span>
      <span className="activity-when">{relTime(event.at)}</span>
    </div>
  );
}
