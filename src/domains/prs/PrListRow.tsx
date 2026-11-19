import { openUrl } from "@tauri-apps/plugin-opener";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { openIssueAnywhere } from "@/domains/board/openIssueAnywhere";
import { useSessionsStore } from "@/domains/sessions/store";
import type { PrOwner, PrRow } from "./prRows";

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

/** Open what a PR belongs to or came from: a ticket (by key, whichever board it's on) or a session. */
function openOwner(owner: PrOwner) {
  if (owner.kind === "issue") void openIssueAnywhere(owner.key);
  else useSessionsStore.getState().select(owner.id);
}

/** Handlers for a clickable inside the row's own click target, which must not open GitHub. */
function nested(run: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      run();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        run();
      }
    },
  };
}

// One pull request: opens on GitHub. Its ticket chip opens the ticket; its "Raised in"
// cell goes back to the session or ticket agent that wrote it.
export function PrListRow({ row }: { row: PrRow }) {
  const { owner, raisedIn } = row;
  const bucket = bucketOf(row.state);
  const StateIcon = STATE_ICON[bucket];
  const open = () => void openUrl(row.url);
  const rowKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") open();
  };
  const fallback = owner.kind === "issue" ? owner.summary : owner.title;
  const branch =
    row.branch ?? (owner.kind === "issue" ? `workspace/${owner.key.toLowerCase()}` : "—");

  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts nested role=buttons; HTML forbids nested interactives
    <div className="pr-row" role="button" tabIndex={0} onClick={open} onKeyDown={rowKey}>
      <span className={`status-dot ${bucket}`}>
        <StateIcon size={12} />
      </span>
      <span className="num">#{row.number}</span>
      <span className="ttl">
        {owner.kind === "issue" && (
          // biome-ignore lint/a11y/useSemanticElements: nested clickable inside a row button; HTML forbids nested buttons
          <span
            className="ticket"
            role="button"
            tabIndex={0}
            aria-label={`Open ${owner.key}`}
            {...nested(() => openOwner(owner))}
          >
            {owner.key}
          </span>
        )}
        <span className="text">{row.title || fallback}</span>
      </span>
      <span className="branch">{branch}</span>
      <span className="raised">
        {raisedIn ? (
          // biome-ignore lint/a11y/useSemanticElements: nested clickable inside a row button; HTML forbids nested buttons
          <span
            className={`raised-link${raisedIn.kind === "issue" ? " key" : ""}`}
            role="button"
            tabIndex={0}
            // The cell truncates a long session name; this is the way to read it whole.
            title={
              raisedIn.kind === "session"
                ? `Open session “${raisedIn.title}”`
                : `Open ${raisedIn.key}'s agent`
            }
            aria-label={
              raisedIn.kind === "session"
                ? `Open session ${raisedIn.title}`
                : `Open ${raisedIn.key}'s agent`
            }
            {...nested(() => openOwner(raisedIn))}
          >
            {raisedIn.kind === "session" ? raisedIn.title || "Untitled session" : raisedIn.key}
          </span>
        ) : (
          <span className="none">—</span>
        )}
      </span>
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
