import { openUrl } from "@tauri-apps/plugin-opener";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { openIssueAnywhere } from "@/domains/board/openIssueAnywhere";
import { useSessionsStore } from "@/domains/sessions/store";
import type { PrRow } from "./prRows";

export type PrTab = "open" | "draft" | "merged" | "closed";

// Map a raw state ("open"/"merged"/"declined"/"draft"/"closed") to a tab.
// `declined` is GitHub's closed-without-merge; unknown states stay under Open so
// nothing silently disappears.
export function bucketOf(state: string): PrTab {
  switch (state.toLowerCase()) {
    case "merged":
      return "merged";
    case "draft":
      return "draft";
    case "declined":
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

const STATE_ICON: Record<PrTab, (p: { size?: number }) => ReactNode> = {
  open: I.GitPR,
  merged: I.GitMerge,
  draft: I.Clock,
  closed: I.X,
};

// One pull request: opens on GitHub; its chip opens what it belongs to, a ticket (by
// key, whichever board it's on) or a session.
export function PrListRow({ row }: { row: PrRow }) {
  const { owner } = row;
  const bucket = bucketOf(row.state);
  const StateIcon = STATE_ICON[bucket];
  const open = () => void openUrl(row.url);
  const openOwner = () => {
    if (owner.kind === "issue") void openIssueAnywhere(owner.key);
    else useSessionsStore.getState().select(owner.id);
  };
  const ownerClick = (e: MouseEvent) => {
    e.stopPropagation();
    openOwner();
  };
  const ownerKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      openOwner();
    }
  };
  const rowKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") open();
  };
  const fallback = owner.kind === "issue" ? owner.summary : owner.title;
  const branch =
    row.branch ?? (owner.kind === "issue" ? `workspace/${owner.key.toLowerCase()}` : "—");

  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts a nested role=button for the owner; HTML forbids nested interactives
    <div className="pr-row" role="button" tabIndex={0} onClick={open} onKeyDown={rowKey}>
      <span className={`status-dot ${bucket}`}>
        <StateIcon size={12} />
      </span>
      <span className="num">#{row.number}</span>
      <span className="ttl">
        {/* biome-ignore lint/a11y/useSemanticElements: nested clickable inside a row button; HTML forbids nested buttons */}
        <span
          className="ticket"
          role="button"
          tabIndex={0}
          title={owner.kind === "session" ? `Open session “${owner.title}”` : undefined}
          aria-label={
            owner.kind === "session" ? `Open session ${owner.title}` : `Open ${owner.key}`
          }
          onClick={ownerClick}
          onKeyDown={ownerKey}
        >
          {owner.kind === "issue" ? owner.key : "Session"}
        </span>
        <span className="text">{row.title || fallback}</span>
      </span>
      <span className="branch">{branch}</span>
      <span className="who">
        {owner.kind === "issue" ? (
          <>
            <AgentAvatar assignee={owner.assignee} />
            <span className="name">{owner.assignee?.displayName ?? "—"}</span>
          </>
        ) : (
          <span className="name">{row.author ?? "—"}</span>
        )}
      </span>
      <span className="col-state">
        <span className={`pr-pill ${bucket}`}>{row.state}</span>
      </span>
    </div>
  );
}
