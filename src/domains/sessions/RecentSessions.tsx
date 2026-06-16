import { statusOf, useBoardStore } from "@/domains/board/store";
import { useSessionDiffs } from "./hooks/useSessionDiffs";
import { relTime } from "./SessionCard";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// The "Recents" sidebar on the Sessions view — the sessions you last opened,
// newest first, for one-click re-entry. Recency lives in the sessions store;
// this resolves ids to live sessions (dropping any since deleted/archived) and
// renders each as a compact card that mirrors the main grid card: CLI badge,
// working/needs-you pill, where it's filed, last-touched time, and +/− changes.
export function RecentSessions() {
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

  return (
    <aside className="session-recents">
      <div className="rs-head">Recent</div>
      {items.length === 0 ? (
        <div className="rs-empty">Sessions you open show up here.</div>
      ) : (
        <ul className="rs-list">
          {items.map((s) => {
            const status = statusOf(running.has(s.id), agentActivity[s.id]);
            // Attention (the blinking "needs you") only while unacknowledged;
            // once seen it reads as a plain active session so it stops nagging.
            const attention = status === "waiting" && !ackedWaiting.has(s.id);
            const where =
              [tabName(s.tab), sectionName(s.section)].filter(Boolean).join(" · ") || "Unfiled";
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
                    <span className={`session-cli ${s.cli}`}>{s.cli}</span>
                    {status === "working" && <span className="thinking">working</span>}
                    {attention && <span className="waiting">needs you</span>}
                    <span className="rs-time">{relTime(s.createdAt)}</span>
                  </div>
                  <div className="rs-name">{s.title}</div>
                  <div className="rs-card-foot">
                    <span className="rs-where">{where}</span>
                    {hasDiff && (
                      <span className="rs-diff">
                        <span className="add">+{stat.add}</span>
                        <span className="del">−{stat.del}</span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
