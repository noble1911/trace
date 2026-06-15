import { statusOf, useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// The "Recents" sidebar on the Sessions view — the last sessions you opened,
// newest first, for one-click re-entry. Recency lives in the sessions store;
// this resolves ids to live sessions (dropping any since deleted) and renders.
export function RecentSessions() {
  const sessions = useSessionsStore((s) => s.sessions);
  const recent = useSessionsStore((s) => s.recent);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const select = useSessionsStore((s) => s.select);
  const running = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);

  // Resolve ids to live sessions, dropping any since deleted or archived —
  // Recents is for jumping back into active work; the bin holds the rest.
  const items = recent
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is ScratchSession => s != null && !s.archivedAt);

  return (
    <aside className="session-recents">
      <div className="rs-head">Recent</div>
      {items.length === 0 ? (
        <div className="rs-empty">Sessions you open show up here.</div>
      ) : (
        <ul className="rs-list">
          {items.map((s) => {
            const status = statusOf(running.has(s.id), agentActivity[s.id]);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`rs-item${selectedId === s.id ? " active" : ""}`}
                  onClick={() => select(s.id)}
                  title={s.title}
                >
                  <span className={`rs-dot ${status}`} />
                  <span className="rs-name">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
