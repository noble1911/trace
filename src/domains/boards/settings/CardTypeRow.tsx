import { useState } from "react";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { InlineConfirm } from "@/components/InlineConfirm";
import type { CardType } from "@/ipc/customBoards";
import { CardTypeForm } from "./CardTypeForm";
import { typeMoveTargets } from "./cardTypes";
import { deleteCardType, updateCardType } from "./typeEdits";

interface CardTypeRowProps {
  boardId: string;
  type: CardType;
  types: CardType[];
  /** Its cards on the board, or null when the board isn't loaded to count them. */
  cards: number | null;
}

/** "" is the no-type choice for a deleted type's cards. */
const NO_TYPE = "";

// One card type: its name and whether it has its own prompt, with edit (the row turns
// into its form) and delete, confirmed in place. Deleting one that has cards asks which
// type takes them, or none: a card is never deleted along with its type.
export function CardTypeRow({ boardId, type, types, cards }: CardTypeRowProps) {
  const [editing, setEditing] = useState(false);
  const targets = typeMoveTargets(types, type.id);
  const [target, setTarget] = useState(targets[0]?.id ?? NO_TYPE);
  // Unknown counts ask too: the backend refuses a type with cards and no target.
  const asks = cards === null || cards > 0;

  if (editing) {
    return (
      <li className="bd-type-row editing">
        <CardTypeForm
          initial={type}
          types={types}
          submitLabel="Save"
          busyLabel="Saving…"
          onCancel={() => setEditing(false)}
          onSubmit={async (name, prompt) => {
            const change = name === type.name ? { prompt } : { name, prompt };
            const ok = await updateCardType(boardId, type.id, change);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  }

  const message = asks ? (
    <>
      Delete “{type.name}” and move its{" "}
      {cards === null ? "cards" : `${cards} card${cards === 1 ? "" : "s"}`} to{" "}
      <select
        className="bd-col-select"
        aria-label="Move its cards to"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value={NO_TYPE}>No type</option>
      </select>
    </>
  ) : (
    <>Delete “{type.name}”?</>
  );

  return (
    <li className="bd-type-row">
      <span className="bd-type-name">{type.name}</span>
      <span className="bd-type-meta">{type.prompt ? "Own prompt" : "Board's prompt"}</span>
      <span className="bd-type-tools">
        <IconButton size="xs" label={`Edit ${type.name}`} onClick={() => setEditing(true)}>
          <I.Pencil size={12} />
        </IconButton>
        <InlineConfirm
          size="xs"
          className="btn icon xs"
          ariaLabel={`Delete ${type.name}`}
          label={<I.Trash size={12} />}
          message={message}
          confirmLabel="Delete"
          onConfirm={() => void deleteCardType(boardId, type.id, asks ? target : undefined)}
        />
      </span>
    </li>
  );
}
