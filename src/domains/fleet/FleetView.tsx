import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useBoardStore } from "@/domains/board/store";
import { type LiveEntry, useLiveEntries } from "@/domains/live/entries";
import { useLiveStore } from "@/domains/live/store";
import type { AgentLight } from "@/domains/live/types";
import { useRowDrag } from "@/domains/live/useRowDrag";
import { useSessionDiffs } from "@/domains/sessions/hooks/useSessionDiffs";
import { useSessionsOverview } from "@/domains/sessions/hooks/useSessionsOverview";
import { useNow } from "@/hooks/useNow";
import { type FleetPr, FleetRow } from "./FleetRow";

type Filter = "all" | AgentLight;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "ready", label: "Ready" },
];

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

interface FleetViewProps {
  onOpen: (workspaceId: string) => void;
}

// Every agent trace is running, as one table — in the order you opened them,
// so rows never jump when an agent changes state. Drag the grip to reorder.
export function FleetView({ onOpen }: FleetViewProps) {
  const entries = useLiveEntries();
  const [filter, setFilter] = useState<Filter>("all");
  const manualOrder = useLiveStore((s) => s.manualOrder);
  const resetOrder = useLiveStore((s) => s.resetOrder);
  const ticketPrs = useBoardStore((s) => s.pullRequests);
  const now = useNow(30_000) * 1000;

  const worktrees = [...new Set(entries.flatMap((e) => (e.worktreeId ? [e.worktreeId] : [])))];
  const overview = useSessionsOverview(worktrees);
  const diffs = useSessionDiffs(worktrees);

  const order = entries.map((e) => e.id);
  const shown = filter === "all" ? entries : entries.filter((e) => e.info.light === filter);
  const drag = useRowDrag(
    order,
    shown.map((e) => e.id)
  );

  const prOf = (e: LiveEntry): FleetPr | null => {
    if (e.source === "ticket") {
      const pr = ticketPrs[e.id]?.[0];
      return pr ? { number: pr.number, state: pr.state, url: pr.url } : null;
    }
    const pr = e.worktreeId ? overview[e.worktreeId]?.pr : null;
    return pr ? { number: pr.number, state: pr.state, url: pr.url } : null;
  };
  const whereOf = (e: LiveEntry): string | null => {
    const o = e.worktreeId ? overview[e.worktreeId] : undefined;
    if (!o) return null;
    return [basename(o.repo), o.branch].filter(Boolean).join(" · ");
  };
  const count = (f: Filter) =>
    f === "all" ? entries.length : entries.filter((e) => e.info.light === f).length;

  return (
    <div className="fleet">
      <header className="fl-head">
        <div>
          <h1>Fleet</h1>
          <div className="fl-desc">
            Every running agent, in the order you opened them — rows stay put when an agent changes
            state; drag to reorder.
          </div>
        </div>
        <div className="fl-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-chip${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="mono">{count(f.id)}</span>
            </button>
          ))}
          {manualOrder && (
            <button type="button" className="btn ghost" onClick={resetOrder}>
              Reset to opened order
            </button>
          )}
        </div>
      </header>

      <div className="fl-scroll">
        <div className="fl-table">
          <div className="fl-row fl-th">
            <span />
            <span>State</span>
            <span>Agent</span>
            <span>Source</span>
            <span>Opened</span>
            <span>In state</span>
            <span>Repo · branch</span>
            <span>Changes</span>
            <span>PR</span>
            <span>Latest</span>
          </div>
          {shown.length === 0 && (
            <div className="fl-empty">
              {entries.length === 0
                ? "No agents running. Start one from the board, Sessions or a schedule."
                : "No agents in this state."}
            </div>
          )}
          {shown.map((e) => (
            <FleetRow
              key={e.id}
              entry={e}
              now={now}
              where={whereOf(e)}
              diff={e.worktreeId ? diffs[e.worktreeId] : undefined}
              pr={prOf(e)}
              dropAbove={drag.dropAbove(e.id)}
              isDragging={drag.dragging === e.id}
              dragProps={drag.rowProps(e.id)}
              onOpen={() => onOpen(e.id)}
              onOpenPr={(url) => void openUrl(url)}
            />
          ))}
          {drag.dropAtEnd() && <div className="fl-drop" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
