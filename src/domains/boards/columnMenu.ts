import type { MenuSection } from "@/components/PopMenu";
import type { BoardColumn } from "@/domains/issues/types";
import { moveColumn, updateColumn } from "./boardEdits";
import { CATEGORIES, CATEGORY_LABELS, columnCategory, columnId, stepIndex } from "./columns";

interface ColumnMenuArgs {
  column: BoardColumn;
  columns: BoardColumn[];
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * A custom column's ⋯: add a card, rename, its category (what makes landing in it
 * start an agent, or count as done), move it left or right, delete it. Moving and the
 * category apply at once; the rest open in the column.
 */
export function columnMenu({
  column,
  columns,
  onAdd,
  onRename,
  onDelete,
}: ColumnMenuArgs): MenuSection[] {
  const id = columnId(column);
  if (!id) return [];
  const current = columnCategory(column);
  const left = stepIndex(columns, id, -1);
  const right = stepIndex(columns, id, 1);
  const isLast = columns.length <= 1;
  return [
    {
      items: [
        { id: "add", label: "Add card", onSelect: onAdd },
        { id: "rename", label: "Rename", onSelect: onRename },
      ],
    },
    {
      title: "Category",
      items: CATEGORIES.map((category) => ({
        id: `category-${category}`,
        label: CATEGORY_LABELS[category],
        checked: category === current,
        onSelect: () => {
          if (category !== current) void updateColumn(id, { category });
        },
      })),
    },
    {
      items: [
        {
          id: "left",
          label: "Move left",
          disabled: left === null,
          onSelect: () => left !== null && void moveColumn(id, left),
        },
        {
          id: "right",
          label: "Move right",
          disabled: right === null,
          onSelect: () => right !== null && void moveColumn(id, right),
        },
      ],
    },
    {
      items: [
        {
          id: "delete",
          label: "Delete column",
          danger: true,
          disabled: isLast,
          detail: isLast ? "A board keeps at least one column" : undefined,
          onSelect: onDelete,
        },
      ],
    },
  ];
}
