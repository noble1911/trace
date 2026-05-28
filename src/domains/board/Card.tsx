import { openUrl } from "@tauri-apps/plugin-opener";
import type { DragEvent, MouseEvent } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import type { Issue, PullRequest } from "@/domains/jira/types";

interface CardProps {
  issue: Issue;
  running: boolean;
  prs?: PullRequest[];
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
}

function prStateClass(state: string): string {
  // Reuse the design's pr-pill variants: open/draft/merged. Declined falls back.
  if (state === "open" || state === "draft" || state === "merged") return state;
  return "draft";
}

// The card outer is a `div role="button"` (rather than a real `<button>`) so we can
// nest a real `<button>` for the PR pill without breaking HTML's no-nested-interactives rule.
export function Card({ issue, running, prs, onOpen, onDragStart }: CardProps) {
  const firstPr = prs && prs.length > 0 ? prs[0] : null;

  const open = () => onOpen(issue.key);
  const onCardKey = (e: { key: string }) => {
    if (e.key === "Enter" || e.key === " ") open();
  };

  const onPrClick = (e: MouseEvent) => {
    if (!firstPr) return;
    e.stopPropagation();
    void openUrl(firstPr.url);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: needs to host a nested <button> for the PR pill (HTML forbids nested interactives) — keyboard activation handled
    <div
      className={`card${running ? " glow" : ""}`}
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => onDragStart(e, issue.key)}
      onClick={open}
      onKeyDown={onCardKey}
    >
      <div className="row">
        <span className={`priority ${issue.priority}`} />
        <span className="ticket-id">{issue.key}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {running && <span className="thinking">working</span>}
          <AgentAvatar assignee={issue.assignee} />
        </span>
      </div>

      <div className="title">{issue.summary}</div>

      <div className="meta">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <I.Ticket size={11} /> {issue.issueType}
        </span>
        {issue.labels.slice(0, 2).map((label) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="dot-sep">·</span>
            {label}
          </span>
        ))}
        {firstPr && (
          <button
            type="button"
            className={`pr-pill ${prStateClass(firstPr.state)}`}
            style={{ marginLeft: "auto", cursor: "pointer" }}
            onClick={onPrClick}
            title={`${firstPr.title || `PR #${firstPr.number}`} — opens on GitHub`}
          >
            <I.GitPR size={11} /> #{firstPr.number}
          </button>
        )}
      </div>
    </div>
  );
}
