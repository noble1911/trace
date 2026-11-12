import { Modal } from "@/components/Modal";
import { useBoardStore } from "@/domains/board/store";
import { BoardNameModal } from "./BoardNameModal";
import { updateCard } from "./boardEdits";
import { CardForm } from "./CardForm";
import { draftFromIssue } from "./cardDraft";
import { useBoardsUi } from "./uiStore";

// The custom boards' dialogs, asked for from elsewhere (the switcher, the empty page,
// a card's menu) through `uiStore`: the board-name dialog and a card's edit dialog.
export function CustomBoardDialogs() {
  const nameDialog = useBoardsUi((s) => s.nameDialog);
  const closeNameDialog = useBoardsUi((s) => s.closeNameDialog);
  const editingKey = useBoardsUi((s) => s.editingCard);
  const editCard = useBoardsUi((s) => s.editCard);
  const editing = useBoardStore((s) =>
    editingKey ? (s.data?.issues.find((i) => i.key === editingKey) ?? null) : null
  );
  const closeEdit = () => editCard(null);

  return (
    <>
      {nameDialog && (
        <BoardNameModal key={nameDialog.mode} dialog={nameDialog} onClose={closeNameDialog} />
      )}
      {editing && (
        <Modal title={`Edit ${editing.key}`} onClose={closeEdit} className="bd-card-modal">
          <CardForm
            initial={draftFromIssue(editing)}
            submitLabel="Save"
            busyLabel="Saving…"
            onCancel={closeEdit}
            onSubmit={async (fields) => {
              const ok = await updateCard(editing.key, fields);
              if (ok) closeEdit();
              return ok;
            }}
          />
        </Modal>
      )}
    </>
  );
}
