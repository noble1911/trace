import { type DragEvent, useRef } from "react";
import { useJiraStore } from "@/domains/jira/store";
import type { ColumnStatus, Issue } from "@/domains/jira/types";
import { AssigneeFilter } from "./AssigneeFilter";
import { Column } from "./Column";
import { columnColor, groupIssuesByColumn } from "./columns";
import { FilterChip } from "./FilterChip";
import { type BoardFilter, useBoardStore } from "./store";

function applyFilter(
  issues: Issue[],
  filter: BoardFilter,
  running: Set<string>,
  assignee: string | null
): Issue[] {
  let out = issues;
  if (assignee !== null) out = out.filter((i) => i.assignee?.accountId === assignee);
  if (filter === "active") return out.filter((i) => i.statusCategory === "indeterminate");
  if (filter === "running") return out.filter((i) => running.has(i.key));
  return out;
}

function Centered({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="inner">
        <div className="title">{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}

export function Board() {
  const data = useBoardStore((s) => s.data);
  const loading = useBoardStore((s) => s.loading);
  const error = useBoardStore((s) => s.error);
  const filter = useBoardStore((s) => s.filter);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const setFilter = useBoardStore((s) => s.setFilter);
  const assigneeFilter = useBoardStore((s) => s.assigneeFilter);
  const setAssigneeFilter = useBoardStore((s) => s.setAssigneeFilter);
  const openIssue = useBoardStore((s) => s.openIssue);
  const moveIssue = useBoardStore((s) => s.moveIssue);
  const currentUserId = useJiraStore((s) => s.user?.accountId ?? null);

  const draggingRef = useRef<string | null>(null);
  // Resolve the effective assignee: until the user picks, default to themselves.
  const effectiveAssignee = assigneeFilter === undefined ? currentUserId : assigneeFilter;

  if (loading && !data) return <Centered title="Loading board…" />;
  if (error && !data) return <Centered title="Couldn't load the board" hint={error} />;
  if (!data) return null;
  if (data.columns.length === 0) {
    return (
      <Centered
        title="This board has no columns configured"
        hint="Configure columns in Jira, then refresh."
      />
    );
  }

  const filtered = applyFilter(data.issues, filter, runningAgents, effectiveAssignee);
  const grouped = groupIssuesByColumn(data.columns, filtered);
  const activeCount = filtered.filter((i) => i.statusCategory === "indeterminate").length;

  const onDragStart = (e: DragEvent, key: string) => {
    draggingRef.current = key;
    e.dataTransfer.effectAllowed = "move";
    // WKWebView (macOS) won't start a real drag session unless some data is set —
    // without this the dragover/drop events never fire and the card just snaps back.
    e.dataTransfer.setData("text/plain", key);
  };
  const onDrop = (status: ColumnStatus) => {
    if (draggingRef.current) {
      void moveIssue(draggingRef.current, status);
      draggingRef.current = null;
    }
  };

  return (
    <div className="board">
      <div className="board-header">
        <div>
          <h1>{data.sprintName ?? data.boardName}</h1>
          <div className="subtitle">
            {filtered.length} issue{filtered.length === 1 ? "" : "s"} · {activeCount} active
          </div>
        </div>
        <div className="right">
          <AssigneeFilter
            issues={data.issues}
            selected={effectiveAssignee}
            onSelect={setAssigneeFilter}
          />
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "active"} onClick={() => setFilter("active")}>
            Active
          </FilterChip>
          <FilterChip active={filter === "running"} onClick={() => setFilter("running")}>
            Running
          </FilterChip>
        </div>
      </div>

      <div className="columns">
        {data.columns.map((col, i) => (
          <Column
            key={col.name}
            column={col}
            color={columnColor(i, data.columns.length)}
            issues={grouped[i]}
            runningKeys={runningAgents}
            pullRequests={pullRequests}
            onOpen={openIssue}
            onDragStart={onDragStart}
            onDrop={onDrop}
          />
        ))}
      </div>
    </div>
  );
}
