import { useMemo } from "react";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { Spinner } from "@/components/Spinner";
import { useActivityStore } from "@/domains/activity/store";
import { useNow } from "@/hooks/useNow";
import { requestRecap } from "./engine";
import { agoLabel, sinceLine } from "./since";
import { useRecap, useRecapStore } from "./store";

interface RecapSectionProps {
  workspaceId: string;
}

const ROWS = [
  ["Goal", "goal"],
  ["Done", "done"],
  ["Now", "now"],
  ["Next", "next"],
] as const;

// The top of a ticket's or session's Details: what happened since the user last
// looked (facts from the activity log, in bold: "new" is weight, not colour), then
// where the agent is up to (Haiku's recap, `engine.ts`). Renders nothing when
// there's neither, so the panel falls back to the agent's last message.
export function RecapSection({ workspaceId }: RecapSectionProps) {
  const recap = useRecap(workspaceId);
  const busy = useRecapStore((s) => s.busy.has(workspaceId));
  const visit = useRecapStore((s) => s.visits[workspaceId]);
  const events = useActivityStore((s) => s.events);
  const now = useNow(30_000) * 1000;

  const since = useMemo(
    () => (visit ? sinceLine(events, workspaceId, visit.before, visit.start) : null),
    [events, workspaceId, visit]
  );

  return (
    <>
      {since && visit && (
        <div className="recap-since">
          <div className="label">Since you looked · {agoLabel(visit.before, visit.start)}</div>
          <p className="recap-since-line">{since}</p>
        </div>
      )}
      {recap ? (
        <div className="recap">
          <div className="recap-head">
            <div className="label">Where it's at</div>
            <IconButton
              size="xs"
              className="ghost"
              label="Refresh recap"
              disabled={busy}
              onClick={() => requestRecap(workspaceId, { force: true, delay: 0 })}
            >
              {busy ? <Spinner size={12} /> : <I.Refresh size={12} />}
            </IconButton>
          </div>
          <dl className="recap-rows">
            {ROWS.map(([label, key]) =>
              recap[key] ? (
                <div key={key} className="recap-row">
                  <dt>{label}</dt>
                  <dd>{recap[key]}</dd>
                </div>
              ) : null
            )}
          </dl>
          <div className="recap-asof" title={new Date(recap.at).toLocaleString()}>
            as of {agoLabel(recap.at, now)} ago
          </div>
        </div>
      ) : (
        busy && (
          <div className="recap-pending">
            <Spinner size={12} /> Summarising where it's at…
          </div>
        )
      )}
    </>
  );
}
