import { AgentAvatar } from "@/components/AgentAvatar";
import type { Assignee, Issue } from "@/domains/jira/types";

// Unique assignees across the board's issues, alphabetical.
function uniqueAssignees(issues: Issue[]): Assignee[] {
  const map = new Map<string, Assignee>();
  for (const i of issues) {
    if (i.assignee?.accountId) map.set(i.assignee.accountId, i.assignee);
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

interface AssigneeFilterProps {
  issues: Issue[];
  /** null = all assignees */
  selected: string | null;
  onSelect: (accountId: string | null) => void;
}

// Jira-style avatar row: click a face to filter the board to that assignee,
// click it again (or All) to clear. Hidden when the board has a single person.
export function AssigneeFilter({ issues, selected, onSelect }: AssigneeFilterProps) {
  const people = uniqueAssignees(issues);
  if (people.length <= 1) return null;

  return (
    <div className="assignee-filter">
      <button
        type="button"
        className={`af-all${selected === null ? " active" : ""}`}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {people.map((p) => (
        <button
          key={p.accountId}
          type="button"
          className={`af-av${selected === p.accountId ? " active" : ""}`}
          onClick={() => onSelect(selected === p.accountId ? null : p.accountId)}
          title={p.displayName}
        >
          <AgentAvatar assignee={p} />
        </button>
      ))}
    </div>
  );
}
