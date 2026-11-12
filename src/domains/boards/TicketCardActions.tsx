import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { InlineConfirm } from "@/components/InlineConfirm";
import { useBoardStore } from "@/domains/board/store";
import type { Issue } from "@/domains/issues/types";
import { deleteCard, updateCard } from "./boardEdits";
import { CardForm } from "./CardForm";
import { draftFromIssue } from "./cardDraft";

interface TicketCardActionsProps {
  issue: Issue;
  editing: boolean;
  onToggleEdit: () => void;
}

// A custom card's own controls in the Ticket tab, at the end of its key line: edit
// (the fields turn into the card's form, below) and delete, confirmed in place.
// Deleting is refused while its agent runs, so it isn't offered then.
export function TicketCardActions({ issue, editing, onToggleEdit }: TicketCardActionsProps) {
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  return (
    <span className="bd-ticket-actions">
      <IconButton size="sm" label="Edit card" aria-pressed={editing} onClick={onToggleEdit}>
        <I.Pencil size={14} />
      </IconButton>
      <InlineConfirm
        size="sm"
        className="btn icon sm"
        ariaLabel="Delete card"
        title={running ? "Stop its agent to delete the card" : undefined}
        disabled={running}
        label={<I.Trash size={14} />}
        message={`Delete ${issue.key}?`}
        confirmLabel="Delete"
        onConfirm={() => void deleteCard(issue.key)}
      />
    </span>
  );
}

/** The card's fields as its form, in place of its title, fields and description. */
export function TicketCardEditor({ issue, onDone }: { issue: Issue; onDone: () => void }) {
  return (
    <div className="bd-ticket-form">
      <CardForm
        initial={draftFromIssue(issue)}
        submitLabel="Save"
        busyLabel="Saving…"
        onCancel={onDone}
        onSubmit={async (fields) => {
          const ok = await updateCard(issue.key, fields);
          if (ok) onDone();
          return ok;
        }}
      />
    </div>
  );
}
