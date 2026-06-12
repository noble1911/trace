import { openUrl } from "@tauri-apps/plugin-opener";
import type { DragEvent, MouseEvent } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { epicColor } from "@/domains/board/epicColor";
import { statusOf, useBoardStore } from "@/domains/board/store";
import { useJiraStore } from "@/domains/jira/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { browseUrl } from "@/domains/jira/url";

interface CardProps {
  issue: Issue;
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
export function Card({ issue, prs, onOpen, onDragStart }: CardProps) {
  const firstPr = prs && prs.length > 0 ? prs[0] : null;
  const status = useBoardStore((s) =>
    statusOf(s.runningAgents.has(issue.key), s.agentActivity[issue.key])
  );
  const kickoff = useBoardStore((s) => s.kickoff);
  const site = useJiraStore((s) => s.session?.site ?? null);
  const epicUrl = issue.epicKey ? browseUrl(site, issue.epicKey) : undefined;

  const onKickoff = (e: MouseEvent) => {
    e.stopPropagation();
    kickoff(issue.key);
  };

  const open = () => onOpen(issue.key);
  const onCardKey = (e: { key: string }) => {
    if (e.key === "Enter" || e.key === " ") open();
  };

  const onPrClick = (e: MouseEvent) => {
    if (!firstPr) return;
    e.stopPropagation();
    void openUrl(firstPr.url);
  };

  const onEpicClick = (e: MouseEvent) => {
    if (!epicUrl) return;
    e.stopPropagation();
    void openUrl(epicUrl);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: needs to host a nested <button> for the PR pill (HTML forbids nested interactives) — keyboard activation handled
    <div
      className={`card${status === "working" ? " glow" : ""}`}
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
          {status === "working" && <span className="thinking">working</span>}
          {status === "waiting" && <span className="waiting">waiting</span>}
          {status === "idle" && (
            <button
              type="button"
              className="card-go"
              onClick={onKickoff}
              title={`Start an agent on ${issue.key} with the ticket brief`}
              aria-label={`Start agent on ${issue.key}`}
            >
              <I.Sparkles size={13} />
            </button>
          )}
          <AgentAvatar assignee={issue.assignee} />
        </span>
      </div>

      {issue.epic && (
        <div className="epic-line">
          {epicUrl ? (
            <button
              type="button"
              className="epic-chip"
              style={{ color: epicColor(issue.epicKey, issue.epicColor) }}
              onClick={onEpicClick}
              title={`${issue.epicKey ?? ""} · ${issue.epic} — opens in Jira`}
            >
              <I.Branch size={10} />
              <span className="epic-name">{issue.epic}</span>
            </button>
          ) : (
            <span
              className="epic-chip"
              style={{ color: epicColor(issue.epicKey, issue.epicColor) }}
              title={issue.epic}
            >
              <I.Branch size={10} />
              <span className="epic-name">{issue.epic}</span>
            </span>
          )}
        </div>
      )}

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
