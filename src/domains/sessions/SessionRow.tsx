import { openUrl } from "@tauri-apps/plugin-opener";
import { type DragEvent, type MouseEvent, useState } from "react";
import { I } from "@/components/Icon";
import type { SessionOverview } from "@/ipc/workspace";
import { companionsOf } from "./agentRoster";
import { sessionsDrag } from "./dragState";
import type { SessionDiffStat } from "./hooks/useSessionDiffs";
import { StatusDot } from "./StatusDot";
import { TitleEditor } from "./TitleEditor";
import { relTime } from "./time";
import type { ScratchSession } from "./types";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/**
 * The branch worth showing: not the auto-named `workspace/<session id>` every
 * session starts on (that's noise), but one the agent created, like `fix/…`.
 */
function meaningfulBranch(session: ScratchSession, branch: string | null): string | null {
  if (!branch) return null;
  const auto = `workspace/${session.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return branch === auto ? null : branch;
}

interface SessionRowProps {
  session: ScratchSession;
  working: boolean;
  needsYou: boolean;
  overview?: SessionOverview;
  diff?: SessionDiffStat;
  onOpen: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
}

// One session as a list row: status dot, name, where it works, its PR, its
// diff and age — the facts that decide which one to open, and nothing else.
// Rename/archive appear on hover; the row drags into sections, tabs and the bin.
export function SessionRow(props: SessionRowProps) {
  const { session, working, needsYou, overview, diff, onOpen, onArchive, onRename } = props;
  const [renaming, setRenaming] = useState(false);
  const companions = companionsOf(session);
  const branch = meaningfulBranch(session, overview?.branch ?? null);
  const where = [overview ? basename(overview.repo) : null, branch].filter(Boolean).join(" · ");
  const pr = overview?.pr;
  const hasDiff = diff != null && (diff.add > 0 || diff.del > 0);

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
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
      className="session-row"
      role="button"
      tabIndex={0}
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={() => {
        sessionsDrag.current = null;
      }}
      onClick={renaming ? undefined : onOpen}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) onOpen();
      }}
    >
      <StatusDot working={working} needsYou={needsYou} />
      <div className="sr-name">
        {renaming ? (
          <TitleEditor
            initial={session.title}
            onSave={onRename}
            onClose={() => setRenaming(false)}
          />
        ) : (
          <span className="sr-title">{session.title}</span>
        )}
        {session.cli !== "claude" && (
          <span className={`session-cli ${session.cli}`}>{session.cli}</span>
        )}
        {companions.length > 0 && (
          <span
            className="session-cli"
            title={`Also in this worktree: ${companions.map((a) => a.cli).join(", ")}`}
          >
            +{companions.length}
          </span>
        )}
      </div>
      <span className="sr-where" title={overview?.branch ?? undefined}>
        {where}
      </span>
      <span className="sr-pr">
        {pr && (
          <button
            type="button"
            className={`pr-pill ${pr.state}`}
            onClick={stop(() => void openUrl(pr.url))}
            title={`Open PR #${pr.number} on GitHub`}
          >
            #{pr.number} {pr.state}
          </button>
        )}
      </span>
      <span className="sr-diff">
        {hasDiff && (
          <>
            <span className="add">+{diff.add}</span> <span className="del">−{diff.del}</span>
          </>
        )}
      </span>
      <span className="sr-time">{relTime(session.createdAt)}</span>
      <span className="sr-actions">
        <button
          type="button"
          onClick={stop(() => setRenaming(true))}
          aria-label="Rename session"
          title="Rename"
        >
          <I.Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={stop(onArchive)}
          aria-label="Archive session"
          title="Archive"
        >
          <I.Archive size={12} />
        </button>
      </span>
    </div>
  );
}
