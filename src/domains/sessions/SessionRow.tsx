import { openUrl } from "@tauri-apps/plugin-opener";
import { type DragEvent, useState } from "react";
import { I } from "@/components/Icon";
import { RowBar, RowMenuPopover } from "@/components/RowMenu";
import { StatusLight } from "@/components/StatusLight";
import { barActions, useRowMenu } from "@/components/useRowMenu";
import { useGroupQuiet } from "@/domains/live/quietStore";
import type { AgentLight } from "@/domains/live/types";
import { useSessionUnread } from "@/domains/live/unreadStore";
import type { SessionOverview } from "@/ipc/workspace";
import { basename } from "@/platform/paths";
import { agentWorkspaceIds, companionsOf } from "./agentRoster";
import { CreatorChip } from "./CreatorChip";
import { creatorLabel, creatorOf } from "./createdBy";
import { sessionsDrag, setRowDragging } from "./dragState";
import { HostChip } from "./HostChip";
import type { SessionDiffStat } from "./hooks/useSessionDiffs";
import type { RowOrdering } from "./SessionList";
import { hostId, hostPlace } from "./sessionHost";
import { sessionRowMenu } from "./sessionRowMenu";
import { TitleEditor } from "./TitleEditor";
import { relTime } from "./time";
import type { ScratchSession } from "./types";

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
  light: AgentLight;
  /** Per-agent breakdown for the light's tooltip. */
  lightDetail: string;
  overview?: SessionOverview;
  diff?: SessionDiffStat;
  onOpen: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
  /** Its place in the list's order (`SessionList`). */
  ordering: RowOrdering;
}

// One session as a list row: status dot, name, where it works, its PR, its
// diff and age — the facts that decide which one to open, and nothing else.
// Its actions are one list (`sessionRowMenu`): Rename and Archive in the bar that
// shows on hover or focus, and all of them behind its ⋯ and its right-click. The
// row drags up and down its list, into other sections, tabs and the bin. One an agent started says who, and links to it;
// sorted by "Started by", it sits indented under its parent instead. Its title is
// bold while it has a finished turn you haven't opened (`live/unreadStore`).
export function SessionRow(props: SessionRowProps) {
  const { session, light, lightDetail, overview, diff, onOpen, onArchive, onRename } = props;
  const { depth, dropMark, onKeyDown } = props.ordering;
  const unread = useSessionUnread(session.id);
  const quiet = useGroupQuiet(agentWorkspaceIds(session));
  const createdBy = creatorOf(session);
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const menu = useRowMenu();
  const companions = companionsOf(session);
  const branch = meaningfulBranch(session, overview?.branch ?? null);
  // A sandbox session has no checkout here to read: say which sandbox and repo.
  const where = session.host
    ? hostPlace(session.host)
    : [overview ? basename(overview.repo) : null, branch].filter(Boolean).join(" · ");
  const pr = overview?.pr;
  const hasDiff = diff != null && (diff.add > 0 || diff.del > 0);

  const actions = sessionRowMenu({
    session,
    pr,
    onOpen,
    onRename: () => setRenaming(true),
    onArchive,
  });
  const onDragStart = (e: DragEvent) => {
    sessionsDrag.current = { kind: "session", id: session.id };
    e.dataTransfer.effectAllowed = "move";
    // WKWebView won't start a drag session without data (see board/Board.tsx).
    e.dataTransfer.setData("text/plain", session.id);
    setRowDragging(true);
    setDragging(true);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: hosts nested buttons; HTML forbids nested interactives */}
      <div
        className={`session-row${dropMark ? ` drop-${dropMark}` : ""}${dragging ? " dragging" : ""}${menu.at ? " menu-open" : ""}${unread ? " unread" : ""}`}
        data-sid={session.id}
        aria-description={unread ? "New since you looked" : undefined}
        role="button"
        tabIndex={0}
        draggable={!renaming}
        onDragStart={onDragStart}
        onDragEnd={() => {
          sessionsDrag.current = null;
          setRowDragging(false);
          setDragging(false);
        }}
        onClick={renaming ? undefined : onOpen}
        onContextMenu={renaming ? undefined : menu.onContextMenu}
        onKeyDown={(e) => {
          if (renaming) return;
          onKeyDown(e);
          // Enter on a button in the row (the ⋯, Rename, the PR) is that button's.
          if (e.target !== e.currentTarget) return;
          if (!e.defaultPrevented && (e.key === "Enter" || e.key === " ")) onOpen();
        }}
      >
        <span className="sr-grip" title="Drag to reorder" aria-hidden="true">
          <I.Grip size={12} />
        </span>
        <StatusLight
          light={light}
          quiet={quiet}
          title={quiet ? undefined : lightDetail}
          variant="word"
        />
        <div className="sr-name">
          {depth > 0 && (
            <span
              className="sr-indent"
              style={{ width: depth * 16 }}
              title={`Started by “${creatorLabel(createdBy)}”, above`}
            >
              <I.StartedBy size={12} />
            </span>
          )}
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
          {session.host && <HostChip host={session.host} />}
          {depth === 0 && <CreatorChip createdBy={createdBy} />}
        </div>
        <span
          className="sr-where"
          title={session.host ? hostId(session.host) : (overview?.branch ?? undefined)}
        >
          {where}
        </span>
        <span className="sr-pr">
          {pr && (
            <button
              type="button"
              className={`pr-pill ${pr.state}`}
              onClick={(e) => {
                e.stopPropagation();
                void openUrl(pr.url);
              }}
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
        <RowBar
          className="sr-actions"
          actions={barActions(actions)}
          menu={menu}
          moreLabel="Session actions"
        />
      </div>
      <RowMenuPopover menu={menu} sections={actions} />
    </>
  );
}
