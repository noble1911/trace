import { useState } from "react";
import { useBoardStore } from "@/domains/board/store";
import { CHOICES, choose } from "@/domains/live/answer";
import { type LiveEntry, useLiveEntries } from "@/domains/live/entries";
import { useLiveStore } from "@/domains/live/store";
import { useRowDrag } from "@/domains/live/useRowDrag";
import { useNow } from "@/hooks/useNow";
import { InboxDetail } from "./InboxDetail";
import { InboxRow } from "./InboxRow";
import { useInboxKeys } from "./useInboxKeys";

type Tab = "needs" | "ready" | "all";

const TABS: { id: Tab; label: string; keep: (e: LiveEntry) => boolean }[] = [
  { id: "needs", label: "Needs you", keep: (e) => e.info.light === "attention" },
  { id: "ready", label: "Ready", keep: (e) => e.info.light === "ready" },
  { id: "all", label: "All live", keep: () => true },
];

const EMPTY: Record<Tab, string> = {
  needs: "Nothing needs you right now.",
  ready: "No agent is sitting finished at its prompt.",
  all: "No agents running. Start one from the board, Sessions or a schedule.",
};

interface InboxViewProps {
  onOpen: (workspaceId: string) => void;
}

// Every agent that wants you — tickets, sessions, companions, scheduled runs —
// in the order you opened them (drag to reorder), with enough beside each to
// answer it without leaving the list.
export function InboxView({ onOpen }: InboxViewProps) {
  const entries = useLiveEntries();
  const [tab, setTab] = useState<Tab>("needs");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nudge = useLiveStore((s) => s.nudge);
  const resetOrder = useLiveStore((s) => s.resetOrder);
  const manualOrder = useLiveStore((s) => s.manualOrder);
  const now = useNow(30_000) * 1000;

  const order = entries.map((e) => e.id);
  const shown = entries.filter(TABS.find((t) => t.id === tab)?.keep ?? (() => true));
  const shownIds = shown.map((e) => e.id);
  const drag = useRowDrag(order, shownIds);
  // Selection follows the list: a row that left this tab hands it to the first.
  const selected = shown.find((e) => e.id === selectedId) ?? shown[0] ?? null;

  const step = (by: -1 | 1) => {
    if (!selected) return;
    const next = shown[shown.indexOf(selected) + by];
    if (next) setSelectedId(next.id);
  };
  /** After answering one, the next agent (in list order) that needs you. */
  const nextNeedingYou = () => {
    const needs = entries.filter((e) => e.info.light === "attention" && e.id !== selected?.id);
    const after = needs.find((e) => order.indexOf(e.id) > order.indexOf(selected?.id ?? ""));
    const next = after ?? needs[0];
    if (next) setSelectedId(next.id);
  };

  useInboxKeys({
    move: step,
    nudge: (by) => selected && nudge(order, selected.id, by),
    open: () => selected && onOpen(selected.id),
    markSeen: () => selected && useBoardStore.getState().ackWaiting(selected.id),
    answer: (i) => {
      // Only for a row the user picked: the fallback selection can shift to a
      // different agent when a row leaves the tab, and an answer must not.
      if (!selected || selectedId !== selected.id) return;
      const kind = selected.info.ask?.kind;
      const choice = kind ? CHOICES[kind]?.[i] : undefined;
      if (selected && choice) void choose(selected.id, choice.choice);
    },
  });

  const count = (t: (typeof TABS)[number]) => entries.filter(t.keep).length;

  return (
    <div className="inbox">
      <section className="ib-list" aria-label="Agents">
        <div className="ib-head">
          <h1>Inbox</h1>
          <span className="ib-dim">across the board, sessions &amp; schedules</span>
        </div>
        <div className="ib-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "on" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label} <span className="mono">{count(t)}</span>
            </button>
          ))}
        </div>
        <div className="ib-order">
          <span>In the order you opened them · drag to reorder</span>
          {manualOrder && (
            <button type="button" onClick={resetOrder}>
              Reset order
            </button>
          )}
        </div>
        <div className="ib-rows">
          {shown.length === 0 && <div className="ib-empty">{EMPTY[tab]}</div>}
          {shown.map((e) => (
            <InboxRow
              key={e.id}
              entry={e}
              now={now}
              selected={e.id === selected?.id}
              dropAbove={drag.dropAbove(e.id)}
              isDragging={drag.dragging === e.id}
              dragProps={drag.rowProps(e.id)}
              onSelect={() => setSelectedId(e.id)}
              onOpen={() => onOpen(e.id)}
            />
          ))}
          {drag.dropAtEnd() && <div className="ib-drop" aria-hidden="true" />}
        </div>
        <div className="ib-keys">
          <span>
            <span className="kbd">J</span> <span className="kbd">K</span> move
          </span>
          <span>
            <span className="kbd">⏎</span> open
          </span>
          <span>
            <span className="kbd">E</span> mark seen
          </span>
          <span>
            <span className="kbd">⌥↑</span> <span className="kbd">⌥↓</span> reorder
          </span>
          <span>
            <span className="kbd">⌘⇧N</span> next needing you, anywhere
          </span>
        </div>
      </section>
      {selected ? (
        <InboxDetail
          key={selected.id}
          entry={selected}
          now={now}
          onOpen={() => onOpen(selected.id)}
          onSentNext={nextNeedingYou}
        />
      ) : (
        <section className="ib-detail ib-detail-empty">
          Select an agent to see what it needs.
        </section>
      )}
    </div>
  );
}
