import { I } from "@/components/Icon";
import { sessionsDrag } from "./dragState";
import { relTime } from "./SessionCard";
import type { ScratchSession } from "./types";

interface ArchiveBinProps {
  archived: ScratchSession[];
  open: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  /** A session card dropped on the bin archives it. */
  onDropSession: (id: string) => void;
}

// The collapsible recycle bin at the bottom of the Sessions page. Doubles as
// a drop target: dragging a card onto it archives the session.
export function ArchiveBin({
  archived,
  open,
  onToggle,
  onRestore,
  onDelete,
  onDropSession,
}: ArchiveBinProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone wrapper; the controls inside are buttons
    <div
      className="archive-bin"
      onDragOver={(e) => {
        if (sessionsDrag.current?.kind === "session") e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const drag = sessionsDrag.current;
        sessionsDrag.current = null;
        if (drag?.kind === "session") onDropSession(drag.id);
      }}
    >
      <button type="button" className="archive-head" onClick={onToggle}>
        <I.Chevron size={13} style={{ transform: open ? "rotate(90deg)" : "none" }} />
        <I.Archive size={13} />
        Archived
        <span className="count">{archived.length}</span>
      </button>
      {open && (
        <div className="archive-list">
          {archived.map((s) => (
            <div key={s.id} className="archive-row">
              <span className={`session-cli ${s.cli}`}>{s.cli}</span>
              <span className="archive-title">{s.title}</span>
              <span className="archive-when">archived {relTime(s.archivedAt ?? 0)}</span>
              <button
                type="button"
                className="archive-action"
                onClick={() => onRestore(s.id)}
                title="Restore"
              >
                <I.Back size={13} /> Restore
              </button>
              <button
                type="button"
                className="archive-action danger"
                onClick={() => onDelete(s.id)}
                title="Delete permanently"
              >
                <I.X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
