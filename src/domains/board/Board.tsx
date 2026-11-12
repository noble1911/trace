import { type CSSProperties, type DragEvent, useRef } from "react";
import { FilterChip } from "@/components/FilterChip";
import { AddColumn } from "@/domains/boards/AddColumn";
import { BoardMenu } from "@/domains/boards/BoardMenu";
import { CustomColumn } from "@/domains/boards/CustomColumn";
import { useCustomTypeFilter } from "@/domains/boards/typeFilterStore";
import { useIssuesStore } from "@/domains/issues/store";
import type { ColumnStatus, Issue } from "@/domains/issues/types";
import { useLiveStore } from "@/domains/live/store";
import { AssigneeFilter } from "./AssigneeFilter";
import { Column } from "./Column";
import { columnColor, groupIssuesByColumn } from "./columns";
import { DensityToggle } from "./DensityToggle";
import type { BoardFilter } from "./filterPrefs";
import { RepoPickModal } from "./RepoPickModal";
import { useBoardStore } from "./store";
import { boardIssueTypes, TypeFilter } from "./TypeFilter";
import { ALL_TYPES, forBoard, showsType, type TypeSelection } from "./typeSelection";

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
  const boardKey = useBoardStore((s) => s.boardKey);
  const customTypes = useCustomTypeFilter((s) => (boardKey ? s.byBoard[boardKey] : undefined));
  const selectCustomTypes = useCustomTypeFilter((s) => s.select);
  const currentUserId = useIssuesStore((s) =>
    boardProvider ? (s.users[boardProvider]?.accountId ?? null) : null
  );

  const draggingRef = useRef<string | null>(null);
  // A custom board (trace's own) is editable, and has no assignees to filter by. Its
  // card types filter like issue types, remembered per board (`typeFilterStore`).
  const isCustom = boardProvider === "custom";
  // Resolve the effective assignee: until the user picks, default to themselves.
  const effectiveAssignee = isCustom
    ? null
    : assigneeFilter === undefined
      ? currentUserId
      : assigneeFilter;

  if (loading && !data) return <Centered title="Loading board…" />;
  if (error && !data) return <Centered title="Couldn't load the board" hint={error} />;
  if (!data) {
    return (
      <Centered
        title="No boards to show"
        hint="This tracker is connected but returned no boards. Check its access, then reconnect it in Integrations."
      />
    );
  }
  if (data.columns.length === 0 && !isCustom) {
    return (
      <Centered
        title="This board has no columns configured"
        hint="Configure its columns in your tracker, then refresh."
      />
    );
  }

  const types = boardIssueTypes(data.issues);
  const typeSel = forBoard(isCustom ? (customTypes ?? ALL_TYPES) : typeFilter, types);
  const onTypes = (sel: TypeSelection) => {
    if (!isCustom) setTypeFilter(sel);
    else if (boardKey) selectCustomTypes(boardKey, sel);
  };
  // Counts on the type chips come from here — every filter but type.
  const visible = applyFilter(data.issues, filter, runningAgents, effectiveAssignee);
  const filtered = visible.filter((i) => showsType(typeSel, i.issueType));
  const grouped = groupIssuesByColumn(data.columns, filtered);
  const noun = isCustom ? "card" : "issue";
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
          <div className="desc">
            {filtered.length} {noun}
            {filtered.length === 1 ? "" : "s"} · {activeCount} active
            {boardLights.length > 0 &&
              ` · ${boardLights.length} agent${boardLights.length === 1 ? "" : "s"} running`}
            {needYou > 0 && <span className="needs-you"> · {needYou} need you</span>}
          </div>
        </div>
        <div className="right">
          <DensityToggle />
          {!isCustom && (
            <AssigneeFilter
              issues={data.issues}
              selected={effectiveAssignee}
              onSelect={setAssigneeFilter}
            />
          )}
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "active"} onClick={() => setFilter("active")}>
            Active
          </FilterChip>
          <FilterChip active={filter === "running"} onClick={() => setFilter("running")}>
            Running
          </FilterChip>
          {boardKey && <BoardMenu data={data} boardKey={boardKey} isCustom={isCustom} />}
        </div>
      </div>

      <TypeFilter types={types} visible={visible} selected={typeSel} onSelect={onTypes} />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragend cleanup on the board container, not an interactive control */}
      <div
        className={isCustom ? "columns bd-columns" : "columns"}
        // The custom board's last track is its "Add column", sized to its content.
        style={isCustom ? ({ "--bd-cols": data.columns.length } as CSSProperties) : undefined}
        onDragEnd={onDragEnd}
      >
        {data.columns.map((col, i) => {
          const shared = {
            column: col,
            issues: grouped[i],
            pullRequests,
            onOpen: openIssue,
            onDragStart,
            onDrop,
          };
          const key = col.statuses[0]?.id ?? col.name;
          return isCustom ? (
            <CustomColumn key={key} {...shared} columns={data.columns} />
          ) : (
            <Column key={key} {...shared} color={columnColor(i, data.columns.length)} />
          );
        })}
        {isCustom && <AddColumn />}
      </div>

      {repoPickFor && <RepoPickModal issueKey={repoPickFor} />}
    </div>
  );
}
