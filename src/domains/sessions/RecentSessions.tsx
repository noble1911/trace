import { statusOf, useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// The "Recents" sidebar on the Sessions view — the last sessions you opened,
// newest first, for one-click re-entry. Recency lives in the sessions store;
// this resolves ids to live sessions (dropping any since deleted/archived),
// shows where each one is filed (tab · category), and a run-state dot.
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
            // Attention (violet) only while unacknowledged; once seen it reads as
            // a plain active session (amber) so it stops nagging.
            const attention = status === "waiting" && !ackedWaiting.has(s.id);
            const dot = attention ? "waiting" : status === "idle" ? "idle" : "working";
            const where =
              [tabName(s.tab), sectionName(s.section)].filter(Boolean).join(" · ") || "Unfiled";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`rs-item${selectedId === s.id ? " active" : ""}`}
                  onClick={() => select(s.id)}
                  title={s.title}
                >
                  <span className={`rs-dot ${dot}`} />
                  <span className="rs-text">
                    <span className="rs-name">{s.title}</span>
                    <span className="rs-where">{where}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
