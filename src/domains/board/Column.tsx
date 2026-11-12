import { type DragEvent, type ReactNode, useState } from "react";
import type { BoardColumn, ColumnStatus, Issue, PullRequest } from "@/domains/issues/types";
import { Card } from "./Card";

interface ColumnProps {
  column: BoardColumn;
  color: string;
  issues: Issue[];
  pullRequests: Record<string, PullRequest[]>;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onDrop: (status: ColumnStatus) => void;
  /** A custom board's column (`boards/CustomColumn`) adds its own controls through these. */
  slots?: ColumnSlots;
}

/** What an editable column adds: its name as a field while renaming, its head's
 * controls, and a form or prompt at the top of its body. */
export interface ColumnSlots {
  name?: ReactNode;
  headEnd?: ReactNode;
  bodyTop?: ReactNode;
  /** Said in an empty column ("No cards"). */
  emptyLabel?: string;
}

export function Column({
  column,
  color,
  issues,
  pullRequests,
  onOpen,
  onDragStart,
  onDrop,
  slots,
}: ColumnProps) {
  // A column can map to several statuses (e.g. In Progress + Blocked). Split the
  // cards into a drop zone per status so a drop transitions to the *exact* status
  // the card landed on, mirroring how Jira sub-divides such columns.
  const multi = column.statuses.length > 1;

  return (
    <div className="column">
      <div className="col-head">
        <span className="col-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        {slots?.name ?? <span className="col-name">{column.name}</span>}
        <span className="col-count">{issues.length}</span>
        {slots?.headEnd}
      </div>
      <div className="col-body">
        {slots?.bodyTop}
        {column.statuses.map((status) => (
          <StatusZone
            key={status.id}
            status={status}
            issues={issues.filter((i) => i.statusId === status.id)}
            multi={multi}
            pullRequests={pullRequests}
            onOpen={onOpen}
            onDragStart={onDragStart}
            onDrop={() => onDrop(status)}
            emptyLabel={slots?.emptyLabel}
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
  pullRequests: Record<string, PullRequest[]>;
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onDrop: () => void;
  emptyLabel?: string;
}

function StatusZone({
  status,
  issues,
  multi,
  pullRequests,
  onOpen,
  onDragStart,
  onDrop,
  emptyLabel = "No issues",
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
            prs={pullRequests[issue.key]}
            onOpen={onOpen}
            onDragStart={onDragStart}
          />
        ))}
        {issues.length === 0 && !multi && <div className="col-empty">{emptyLabel}</div>}
      </div>
    </div>
  );
}
