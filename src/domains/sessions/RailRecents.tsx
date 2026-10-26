import { StatusLight } from "@/components/StatusLight";
import { useLiveStore } from "@/domains/live/store";
import { sessionLight } from "./agentRoster";
import { useSessionsStore } from "./store";
import { relTime } from "./time";
import type { ScratchSession } from "./types";

/** How many recent sessions the flyout lists. */
const MAX = 8;

// Sessions' own navigation, in the rail: while Sessions is selected, resting on
// its button slides out the sessions you last opened (after a short delay, so
// passing over it doesn't); moving away slides them back. The Rail mounts this
// only on Sessions.
export function RailRecents() {
  const sessions = useSessionsStore((s) => s.sessions);
  const recent = useSessionsStore((s) => s.recent);
  const selectedId = useSessionsStore((s) => s.selectedId);
  const select = useSessionsStore((s) => s.select);
  const live = useLiveStore((s) => s.info);

  const items = recent
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is ScratchSession => s != null && !s.archivedAt)
    .slice(0, MAX);

  return (
    <div className="rr-flyout">
      <div className="rr-panel">
        <div className="rr-head">Recent sessions</div>
        {items.length === 0 && <div className="rr-empty">Sessions you open show up here.</div>}
        {items.map((s) => {
          const { light, detail } = sessionLight(s, live);
          return (
            <button
              key={s.id}
              type="button"
              className={`rr-row${s.id === selectedId ? " active" : ""}`}
              onClick={() => select(s.id)}
            >
              <StatusLight light={light} title={detail} />
              <span className="rr-title">{s.title}</span>
              <span className="rr-time">{relTime(s.createdAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
