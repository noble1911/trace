import { useState } from "react";
import { ConfirmPrompt } from "@/components/InlineConfirm";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import type { BoardData } from "@/domains/issues/types";
import { useLiveStore } from "@/domains/live/store";
import { deleteBoard } from "./boardList";
import { useBoardsUi } from "./uiStore";

// A custom board's ⋯, at the end of its header: rename it, make another, delete it.
// Deleting is confirmed in place of the ⋯ (trace-ui §5), and isn't offered while one
// of its cards has an agent (the backend refuses it too).
export function CustomBoardMenu({ data }: { data: BoardData }) {
  const [deleting, setDeleting] = useState(false);
  const openNameDialog = useBoardsUi((s) => s.openNameDialog);
  const running = useLiveStore((s) => data.issues.filter((i) => s.info[i.key]).length);
  const cards = data.issues.length;

  if (deleting) {
    return (
      <ConfirmPrompt
        size="sm"
        message={`Delete ${data.boardName}${cards > 0 ? ` and its ${cards} card${cards === 1 ? "" : "s"}` : ""}?`}
        confirmLabel="Delete board"
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          void deleteBoard(data.boardId, data.boardName);
        }}
      />
    );
  }
  return (
    <PopMenu
      trigger={({ open, toggle }) => (
        <MoreTrigger open={open} toggle={toggle} size="sm" label="Board actions" />
      )}
      sections={[
        {
          items: [
            {
              id: "rename",
              label: "Rename board…",
              onSelect: () =>
                openNameDialog({ mode: "rename", boardId: data.boardId, name: data.boardName }),
            },
            { id: "new", label: "New board…", onSelect: () => openNameDialog({ mode: "new" }) },
          ],
        },
        {
          items: [
            {
              id: "delete",
              label: "Delete board",
              danger: true,
              disabled: running > 0,
              detail: running > 0 ? "Stop its cards' agents first" : undefined,
              onSelect: () => setDeleting(true),
            },
          ],
        },
      ]}
    />
  );
}
