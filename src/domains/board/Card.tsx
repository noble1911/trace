import type { DragEvent } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import type { Issue } from "@/domains/jira/types";

interface CardProps {
  issue: Issue;
  running: boolean;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
}

export function Card({ issue, running, onOpen, onDragStart }: CardProps) {
  return (
    <button
      type="button"
      className={`card${running ? " glow" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, issue.key)}
      onClick={() => onOpen(issue.key)}
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
      </div>
    </button>
  );
}
