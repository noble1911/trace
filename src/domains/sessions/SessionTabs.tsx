import { type DragEvent, useState } from "react";
import { I } from "@/components/Icon";
import { sessionsDrag } from "./dragState";
import { TitleEditor } from "./TitleEditor";
import type { SessionTab } from "./types";

interface SessionTabsProps {
  tabs: SessionTab[];
  /** Active session count per tab id (null key = the default tab). */
  countOf: (tab: string | null) => number;
  active: string | null;
  onSelect: (tab: string | null) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** `dragId` dropped onto `targetId` — reorder before it. */
  onReorder: (dragId: string, targetId: string) => void;
  /** A session card dropped onto a tab — file it there. */
  onDropSession: (sessionId: string, tab: string | null) => void;
}

// The design's tab-bar, repurposed: one tab per user-defined view. Tabs drag
// to reorder and accept session drops; the active custom tab gets rename and
// delete actions at the end of the bar.
export function SessionTabs({
  tabs,
  countOf,
  active,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onDropSession,
}: SessionTabsProps) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const activeTab = tabs.find((t) => t.id === active) ?? null;

  const dropHandlers = (tab: string | null) => ({
    onDragOver: (e: DragEvent) => {
      const drag = sessionsDrag.current;
      if (!drag) return;
      if (drag.kind === "session" || (drag.kind === "tab" && tab !== null && drag.id !== tab)) {
        e.preventDefault();
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const drag = sessionsDrag.current;
      sessionsDrag.current = null;
      if (!drag) return;
      if (drag.kind === "session") onDropSession(drag.id, tab);
      else if (drag.kind === "tab" && tab !== null && drag.id !== tab) onReorder(drag.id, tab);
    },
  });

  return (
    <div className="tab-bar">
      <button
        type="button"
        className={active === null ? "active" : ""}
        onClick={() => onSelect(null)}
        {...dropHandlers(null)}
      >
        General<span className="count">{countOf(null)}</span>
      </button>
      {tabs.map((t) => (
        <button
          type="button"
          key={t.id}
          className={active === t.id ? "active" : ""}
          onClick={() => onSelect(t.id)}
          draggable
          onDragStart={(e) => {
            sessionsDrag.current = { kind: "tab", id: t.id };
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", t.id);
          }}
          onDragEnd={() => {
            sessionsDrag.current = null;
          }}
          {...dropHandlers(t.id)}
        >
          {t.name}
          <span className="count">{countOf(t.id)}</span>
        </button>
      ))}
      {adding ? (
        <TitleEditor initial="" onSave={onAdd} onClose={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className="tab-add"
          onClick={() => setAdding(true)}
          title="New tab"
          aria-label="New tab"
        >
          <I.Plus size={13} />
        </button>
      )}
      {activeTab &&
        (renaming ? (
          <TitleEditor
            initial={activeTab.name}
            onSave={(name) => onRename(activeTab.id, name)}
            onClose={() => setRenaming(false)}
          />
        ) : (
          <span className="tab-actions">
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Rename tab"
              title="Rename tab"
            >
              <I.Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(activeTab.id)}
              aria-label="Delete tab"
              title="Delete tab (its sessions move to General)"
            >
              <I.X size={12} />
            </button>
          </span>
        ))}
    </div>
  );
}
