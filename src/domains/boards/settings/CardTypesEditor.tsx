import { useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { CardTypeForm } from "./CardTypeForm";
import { CardTypeRow } from "./CardTypeRow";
import { typeCardCount } from "./cardTypes";
import { addCardType } from "./typeEdits";
import { useCardTypes } from "./useBoardSetup";

// A custom board's card types in its settings: the list, each editable in place, and
// "Add type". Unlike the prompt and repos above them, each change applies at once.
export function CardTypesEditor({ boardId }: { boardId: string }) {
  const types = useCardTypes(boardId);
  const [adding, setAdding] = useState(false);
  // Counted on the loaded board; null when this board isn't the one loaded.
  const issues = useBoardStore((s) =>
    s.provider === "custom" && s.data?.boardId === boardId ? s.data.issues : null
  );

  return (
    <div className="bd-types">
      {types.length === 0 && !adding && (
        <div className="bd-repo-empty">
          No types: every card is a Task. Add some to give kinds of card their own prompt.
        </div>
      )}
      {types.length > 0 && (
        <ul className="bd-type-list" aria-label="Card types">
          {types.map((t) => (
            <CardTypeRow
              key={t.id}
              boardId={boardId}
              type={t}
              types={types}
              cards={issues ? typeCardCount(issues, t.name) : null}
            />
          ))}
        </ul>
      )}
      {adding ? (
        <CardTypeForm
          types={types}
          submitLabel="Add type"
          busyLabel="Adding…"
          onCancel={() => setAdding(false)}
          onSubmit={async (name, prompt) => {
            const ok = await addCardType(boardId, name, prompt);
            if (ok) setAdding(false);
            return ok;
          }}
        />
      ) : (
        <button type="button" className="btn sm bd-type-add" onClick={() => setAdding(true)}>
          <I.Plus size={14} /> Add type
        </button>
      )}
    </div>
  );
}
