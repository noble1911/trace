import { type DragEvent, useRef } from "react";
import { useIssuesStore } from "@/domains/issues/store";
import type { ColumnStatus, Issue } from "@/domains/issues/types";
import { useLiveStore } from "@/domains/live/store";
import { AssigneeFilter } from "./AssigneeFilter";
import { Column } from "./Column";
import { columnColor, groupIssuesByColumn } from "./columns";
import { DensityToggle } from "./DensityToggle";
import { FilterChip } from "./FilterChip";
import type { BoardFilter } from "./filterPrefs";
import { RepoPickModal } from "./RepoPickModal";
import { useBoardStore } from "./store";
import { boardIssueTypes, TypeFilter } from "./TypeFilter";
import { forBoard, showsType } from "./typeSelection";

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
  const live = useLiveStore((s) => s.info);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const setFilter = useBoardStore((s) => s.setFilter);
  const assigneeFilter = useBoardStore((s) => s.assigneeFilter);
  const setAssigneeFilter = useBoardStore((s) => s.setAssigneeFilter);
  const typeFilter = useBoardStore((s) => s.typeFilter);
  const setTypeFilter = useBoardStore((s) => s.setTypeFilter);
  const openIssue = useBoardStore((s) => s.openIssue);
  const moveIssue = useBoardStore((s) => s.moveIssue);
  const repoPickFor = useBoardStore((s) => s.repoPickFor);
  const boardProvider = useBoardStore((s) => s.provider);
  const currentUserId = useIssuesStore((s) =>
    boardProvider ? (s.users[boardProvider]?.accountId ?? null) : null
  );

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

  const types = boardIssueTypes(data.issues);
  const typeSel = forBoard(typeFilter, types);
  // Counts on the type chips come from here — every filter but type.
  const visible = applyFilter(data.issues, filter, runningAgents, effectiveAssignee);
  const filtered = visible.filter((i) => showsType(typeSel, i.issueType));
  const grouped = groupIssuesByColumn(data.columns, filtered);
  const activeCount = filtered.filter((i) => i.statusCategory === "indeterminate").length;
  // This board's agents: how many run, how many need you.
  const boardLights = data.issues.flatMap((i) => (live[i.key] ? [live[i.key].light] : []));
  const needYou = boardLights.filter((l) => l === "attention").length;

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
  // dragend bubbles up from the card even when the drop happened outside any
  // StatusZone — without this a cancelled drag leaves a stale key that the
  // next drop would move instead of the card actually dragged.
  const onDragEnd = () => {
    draggingRef.current = null;
  };

  return (
    <div className="board">
      <div className="board-header">
        <div>
          <h1>{data.sprintName ?? data.boardName}</h1>
          <div className="subtitle">
            {filtered.length} issue{filtered.length === 1 ? "" : "s"} · {activeCount} active
            {boardLights.length > 0 &&
              ` · ${boardLights.length} agent${boardLights.length === 1 ? "" : "s"} running`}
            {needYou > 0 && <span className="needs-you"> · {needYou} need you</span>}
          </div>
        </div>
        <div className="right">
          <DensityToggle />
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

      <TypeFilter types={types} visible={visible} selected={typeSel} onSelect={setTypeFilter} />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragend cleanup on the board container, not an interactive control */}
      <div className="columns" onDragEnd={onDragEnd}>
        {data.columns.map((col, i) => (
          <Column
            key={col.name}
            column={col}
            color={columnColor(i, data.columns.length)}
            issues={grouped[i]}
            pullRequests={pullRequests}
            onOpen={openIssue}
            onDragStart={onDragStart}
            onDrop={onDrop}
          />
        ))}
      </div>

      {repoPickFor && <RepoPickModal issueKey={repoPickFor} />}
    </div>
  );
}
