import { useState } from "react";
import { ConfirmPrompt } from "@/components/InlineConfirm";
import { useBoardStore } from "@/domains/board/store";
import type { BoardColumn } from "@/domains/issues/types";
import { deleteColumn } from "./boardEdits";
import { cardCount, columnId, moveTargets } from "./columns";

interface DeleteColumnPromptProps {
  column: BoardColumn;
  columns: BoardColumn[];
  onDone: () => void;
}

// Deleting a column, confirmed in the column (trace-ui §5). An empty one just goes; one
// with cards asks which column takes them (the next one by default), since a card is
// never deleted along with its column.
export function DeleteColumnPrompt({ column, columns, onDone }: DeleteColumnPromptProps) {
  const id = columnId(column) ?? "";
  // Every card, not just the ones the board's filters show.
  const count = useBoardStore((s) => cardCount(s.data?.issues ?? [], id));
  const targets = moveTargets(columns, id);
  const at = columns.findIndex((c) => columnId(c) === id);
  const next = targets.find((t) => columns.findIndex((c) => columnId(c) === t.id) > at);
  const [target, setTarget] = useState(next?.id ?? targets[0]?.id ?? "");

  const confirm = async () => {
    await deleteColumn(id, count > 0 ? target : undefined);
    onDone();
  };

  const message =
    count === 0 ? (
      <>Delete “{column.name}”?</>
    ) : (
      <>
        Delete “{column.name}” and move its {count} card{count === 1 ? "" : "s"} to{" "}
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
        </select>
      </>
    );

  return (
    <div className="bd-col-band">
      <ConfirmPrompt
        size="sm"
        message={message}
        confirmLabel="Delete"
        onCancel={onDone}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
