import { type ComponentProps, useState } from "react";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import { Column } from "@/domains/board/Column";
import type { BoardColumn } from "@/domains/issues/types";
import { createCard } from "./boardEdits";
import { CardForm } from "./CardForm";
import { ColumnNameField } from "./ColumnNameField";
import { EMPTY_DRAFT } from "./cardDraft";
import { columnMenu } from "./columnMenu";
import { categoryColor, columnCategory, columnId } from "./columns";
import { DeleteColumnPrompt } from "./DeleteColumnPrompt";

type CustomColumnProps = Omit<ComponentProps<typeof Column>, "slots" | "color"> & {
  /** Every column on the board, for moving and for where a deleted one's cards go. */
  columns: BoardColumn[];
};

type Mode = "idle" | "adding" | "renaming" | "deleting";

// A custom board's column: the board's own Column, plus a quiet "+" (add a card) and a
// ⋯ (rename, category, move, delete) in its head, shown on hover or focus. The add
// form, a rename and the delete prompt all happen in place, in the column.
export function CustomColumn({ columns, ...props }: CustomColumnProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const id = columnId(props.column);
  if (!id) return <Column {...props} color={categoryColor("new")} />;
  const idle = () => setMode("idle");
  const sections = columnMenu({
    column: props.column,
    columns,
    onAdd: () => setMode("adding"),
    onRename: () => setMode("renaming"),
    onDelete: () => setMode("deleting"),
  });

  const bodyTop =
    mode === "adding" ? (
      <div className="bd-col-form">
        <CardForm
          initial={EMPTY_DRAFT}
          size="sm"
          submitLabel="Add card"
          busyLabel="Adding…"
          onCancel={idle}
          onSubmit={async (fields) => {
            const issue = await createCard(fields, id);
            if (issue) idle();
            return issue !== null;
          }}
        />
      </div>
    ) : mode === "deleting" ? (
      <DeleteColumnPrompt column={props.column} columns={columns} onDone={idle} />
    ) : undefined;

  return (
    <Column
      {...props}
      color={categoryColor(columnCategory(props.column))}
      slots={{
        name:
          mode === "renaming" ? (
            <ColumnNameField columnId={id} name={props.column.name} onDone={idle} />
          ) : undefined,
        headEnd: (
          <span className={mode === "idle" ? "bd-col-tools" : "bd-col-tools on"}>
            <IconButton
              size="xs"
              className="ghost"
              label="Add card"
              aria-pressed={mode === "adding"}
              onClick={() => setMode(mode === "adding" ? "idle" : "adding")}
            >
              <I.Plus size={12} />
            </IconButton>
            <PopMenu
              trigger={({ open, toggle }) => (
                <MoreTrigger
                  open={open}
                  toggle={toggle}
                  size="xs"
                  className="ghost"
                  label="Column actions"
                />
              )}
              sections={sections}
            />
          </span>
        ),
        bodyTop,
        emptyLabel: "No cards",
      }}
    />
  );
}
