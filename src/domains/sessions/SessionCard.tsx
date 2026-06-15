import { type DragEvent, type MouseEvent, useState } from "react";
import { I } from "@/components/Icon";
import type { SessionStatus } from "@/domains/board/store";
import { sessionsDrag } from "./dragState";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

export function relTime(epochSecs: number): string {
  const diff = Date.now() / 1000 - epochSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface SessionCardProps {
  session: ScratchSession;
  status: SessionStatus;
  /** True once you've looked at this waiting session — silences "needs you". */
  acked?: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
}

export function SessionCard({
  session,
  status,
  acked,
  onOpen,
  onArchive,
  onRename,
}: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const archive = (e: MouseEvent) => {
    e.stopPropagation();
    onArchive();
  };
  const startRename = (e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
  };
  const onDragStart = (e: DragEvent) => {
    sessionsDrag.current = { kind: "session", id: session.id };
    e.dataTransfer.effectAllowed = "move";
    // WKWebView won't start a drag session without data (see board/Board.tsx).
    e.dataTransfer.setData("text/plain", session.id);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts nested buttons; HTML forbids nested interactives
    <div
      className="session-card"
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => {
        sessionsDrag.current = null;
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
    >
      <div className="session-card-head">
        <span className={`session-cli ${session.cli}`}>{session.cli}</span>
        {status === "working" && <span className="thinking">working</span>}
        {status === "waiting" && !acked && <span className="waiting">needs you</span>}
        <button
          type="button"
          className="session-del"
          onClick={startRename}
          aria-label="Rename session"
          title="Rename"
        >
          <I.Pencil size={13} />
        </button>
        <button
          type="button"
          className="session-del"
          onClick={archive}
          aria-label="Archive session"
          title="Archive"
        >
          <I.Archive size={13} />
        </button>
      </div>
      {renaming ? (
        <TitleEditor initial={session.title} onSave={onRename} onClose={() => setRenaming(false)} />
      ) : (
        <div className="session-title">{session.title}</div>
      )}
      <div className="session-meta">{relTime(session.createdAt)}</div>
    </div>
  );
}
