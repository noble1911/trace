import { type DragEvent, type ReactNode, useState } from "react";
import { I } from "@/components/Icon";
import { sessionsDrag } from "./dragState";
import { TitleEditor } from "./TitleEditor";
import type { SessionSection } from "./types";

interface SectionGroupProps {
  section: SessionSection;
  count: number;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** A session card was dropped on this section. */
  onDropSession: (sessionId: string) => void;
  /** Another section's header was dropped on this one (reorder before it). */
  onDropSection: (sectionId: string) => void;
  children: ReactNode;
}

// One collapsible vertical group of sessions within a tab. The header drags
// to reorder sections; the whole group accepts session-card drops.
export function SectionGroup({
  section,
  count,
  onToggle,
  onRename,
  onDelete,
  onDropSession,
  onDropSection,
  children,
}: SectionGroupProps) {
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const onDragOver = (e: DragEvent) => {
    const drag = sessionsDrag.current;
    if (!drag) return;
    if (drag.kind === "session" || (drag.kind === "section" && drag.id !== section.id)) {
      e.preventDefault();
      setOver(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const drag = sessionsDrag.current;
    sessionsDrag.current = null;
    if (!drag) return;
    if (drag.kind === "session") onDropSession(drag.id);
    else if (drag.kind === "section" && drag.id !== section.id) onDropSection(drag.id);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone wrapper; the interactive controls are the buttons inside
    <section
      className={`sec-group${over ? " drop-target" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle row; its controls are real buttons */}
      <div
        className="sec-head"
        draggable={!renaming}
        onDragStart={(e) => {
          sessionsDrag.current = { kind: "section", id: section.id };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", section.id);
        }}
        onDragEnd={() => {
          sessionsDrag.current = null;
        }}
      >
        <button
          type="button"
          className="sec-toggle"
          onClick={onToggle}
          aria-expanded={!section.collapsed}
          aria-label={section.collapsed ? "Expand section" : "Collapse section"}
        >
          <I.Chevron
            size={13}
            style={{ transform: section.collapsed ? "none" : "rotate(90deg)" }}
          />
        </button>
        {renaming ? (
          <TitleEditor
            initial={section.name}
            onSave={onRename}
            onClose={() => setRenaming(false)}
          />
        ) : (
          <span className="sec-name">{section.name}</span>
        )}
        <span className="count">{count}</span>
        <span className="sec-actions">
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label="Rename section"
            title="Rename"
          >
            <I.Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete section"
            title="Delete section (its sessions stay)"
          >
            <I.X size={12} />
          </button>
        </span>
      </div>
      {!section.collapsed && children}
    </section>
  );
}
