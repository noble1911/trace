import { type DragEvent, useState } from "react";
import type { BoardColumn, ColumnStatus, Issue, PullRequest } from "@/domains/jira/types";
import { Card } from "./Card";

interface ColumnProps {
  column: BoardColumn;
  color: string;
  issues: Issue[];
  runningKeys: Set<string>;
  pullRequests: Record<string, PullRequest[]>;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onDrop: (status: ColumnStatus) => void;
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
  // A column can map to several statuses (e.g. In Progress + Blocked). Split the
  // cards into a drop zone per status so a drop transitions to the *exact* status
  // the card landed on, mirroring how Jira sub-divides such columns.
  const multi = column.statuses.length > 1;

  return (
    <div className="column">
      <div className="col-head">
        <span className="col-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="col-name">{column.name}</span>
        <span className="col-count">{issues.length}</span>
      </div>
      <div className="col-body">
        {column.statuses.map((status) => (
          <StatusZone
            key={status.id}
            status={status}
            issues={issues.filter((i) => i.statusId === status.id)}
            multi={multi}
            runningKeys={runningKeys}
            pullRequests={pullRequests}
            onOpen={onOpen}
            onDragStart={onDragStart}
            onDrop={() => onDrop(status)}
          />
        ))}
        {column.statuses.length === 0 && <div className="col-empty">No statuses</div>}
      </div>
    </div>
  );
}

interface StatusZoneProps {
  status: ColumnStatus;
  issues: Issue[];
  multi: boolean;
  runningKeys: Set<string>;
  pullRequests: Record<string, PullRequest[]>;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onDrop: () => void;
}

function StatusZone({
  status,
  issues,
  multi,
  runningKeys,
  pullRequests,
  onOpen,
  onDragStart,
  onDrop,
}: StatusZoneProps) {
  const [over, setOver] = useState(false);

  return (
    <div className={`status-zone${multi ? " multi" : ""}`}>
      {multi && <div className="zone-label">{status.name}</div>}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: kanban drop zone is inherently a container div */}
      <div
        className={`zone-cards${over ? " drop-target" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop();
        }}
      >
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
        {issues.length === 0 && !multi && <div className="col-empty">No issues</div>}
      </div>
    </div>
  );
}
