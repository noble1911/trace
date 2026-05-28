import { type DragEvent, useState } from "react";
import type { BoardColumn, Issue, PullRequest } from "@/domains/jira/types";
import { Card } from "./Card";

interface ColumnProps {
  column: BoardColumn;
  color: string;
  issues: Issue[];
  runningKeys: Set<string>;
  pullRequests: Record<string, PullRequest[]>;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onDrop: (column: BoardColumn) => void;
}

export function Column({
  column,
  color,
  issues,
  runningKeys,
  pullRequests,
  onOpen,
  onDragStart,
  onDrop,
}: ColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <div className="column">
      <div className="col-head">
        <span className="col-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="col-name">{column.name}</span>
        <span className="col-count">{issues.length}</span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: kanban drop zone is inherently a container div */}
      <div
        className={`cards${over ? " drop-target" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop(column);
        }}
      >
        {issues.length === 0 && <div className="col-empty">No issues</div>}
        {issues.map((issue) => (
          <Card
            key={issue.key}
            issue={issue}
            running={runningKeys.has(issue.key)}
            prs={pullRequests[issue.key]}
            onOpen={onOpen}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  );
}
