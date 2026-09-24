import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { sessionNeedsYou, sessionStatus } from "./agentRoster";
import { useSessionDiffs } from "./hooks/useSessionDiffs";
import { useRecentsCollapsed } from "./recentsLayout";
import { relTime } from "./SessionCard";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// The "Recents" sidebar on the Sessions view — the sessions you last opened,
// newest first, for one-click re-entry. Recency lives in the sessions store;
// this resolves ids to live sessions (dropping any since deleted/archived) and
// renders each as a two-line card: a status dot (working / needs you), title and
// time, then where it's filed and its +/− — the CLI only when it isn't claude.
export function RecentSessions() {
  const [collapsed, toggle] = useRecentsCollapsed();
  const sessions = useSessionsStore((s) => s.sessions);
  const groups = useSessionsStore((s) => s.groups);
  const recent = useSessionsStore((s) => s.recent);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const select = useSessionsStore((s) => s.select);
  const running = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const ackedWaiting = useBoardStore((s) => s.ackedWaiting);

  const items = recent
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is ScratchSession => s != null && !s.archivedAt);

  // Diff stats only make sense for sessions with their own worktree.
  const diffs = useSessionDiffs(items.filter((s) => s.worktree).map((s) => s.id));

  const tabName = (id?: string | null) => groups.tabs.find((t) => t.id === id)?.name;
  const sectionName = (id?: string | null) => groups.sections.find((s) => s.id === id)?.name;

  // Collapsed: a slim strip with the way back, flagging any session that needs
  // you so closing the column doesn't hide that.
  if (collapsed) {
    const needsYou = items.some((s) => sessionNeedsYou(s, running, agentActivity, ackedWaiting));
    return (
      <aside className="session-recents collapsed">
        <button
          type="button"
          className="rs-toggle"
          onClick={toggle}
          title="Show recent sessions"
          aria-label="Show recent sessions"
        >
          <I.Back size={14} />
          {needsYou && <span className="rs-attn" />}
        </button>
      </aside>
    );
  }

  return (
    <aside className="session-recents">
      <div className="rs-head">
        Recent
        <button
          type="button"
          className="rs-toggle"
          onClick={toggle}
          title="Hide recent sessions"
          aria-label="Hide recent sessions"
        >
          <I.Chevron size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="rs-empty">Sessions you open show up here.</div>
      ) : (
        <ul className="rs-list">
          {items.map((s) => {
            // Status covers every agent on the session (its own plus companions).
            const status = sessionStatus(s, running, agentActivity);
            // Attention (the blinking "needs you") only while unacknowledged;
            // once seen it reads as a plain active session so it stops nagging.
            const attention = sessionNeedsYou(s, running, agentActivity, ackedWaiting);
            const where = [tabName(s.tab), sectionName(s.section)].filter(Boolean).join(" · ");
            const dot = attention ? "attention" : status === "working" ? "working" : null;
            const stat = diffs[s.id];
            const hasDiff = stat != null && (stat.add > 0 || stat.del > 0);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`rs-card${selectedId === s.id ? " active" : ""}`}
                  onClick={() => select(s.id)}
                  title={s.title}
                >
                  <div className="rs-card-top">
                    <span
                      className={`rs-dot${dot ? ` ${dot}` : ""}`}
                      title={attention ? "Needs you" : status === "working" ? "Working" : undefined}
                    />
                    <span className="rs-name">{s.title}</span>
                    <span className="rs-time">{relTime(s.createdAt)}</span>
                  </div>
                  {(s.cli !== "claude" || where || hasDiff) && (
                    <div className="rs-card-foot">
                      {s.cli !== "claude" && (
                        <span className={`session-cli ${s.cli}`}>{s.cli}</span>
                      )}
                      <span className="rs-where">{where}</span>
                      {hasDiff && (
                        <span className="rs-diff">
                          <span className="add">+{stat.add}</span>
                          <span className="del">−{stat.del}</span>
                        </span>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
