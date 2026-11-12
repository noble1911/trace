import { Modal } from "@/components/Modal";
import { useBoardStore } from "@/domains/board/store";
import { BoardNameModal } from "./BoardNameModal";
import { updateCard } from "./boardEdits";
import { CardForm } from "./CardForm";
import { draftFromIssue } from "./cardDraft";
import { NewBoardModal } from "./NewBoardModal";
import { BoardSettingsModal } from "./settings/BoardSettingsModal";
import { useBoardsUi } from "./uiStore";

// The boards' dialogs, asked for from elsewhere (the switcher, the empty page, a board's
// or a card's menu) through `uiStore`: making or renaming a board, any board's
// settings, and a card's edit dialog.
export function CustomBoardDialogs() {
  const nameDialog = useBoardsUi((s) => s.nameDialog);
  const closeNameDialog = useBoardsUi((s) => s.closeNameDialog);
  const settingsFor = useBoardsUi((s) => s.settingsFor);
  const openSettings = useBoardsUi((s) => s.openSettings);
  const editingKey = useBoardsUi((s) => s.editingCard);
  const editCard = useBoardsUi((s) => s.editCard);
  const editing = useBoardStore((s) =>
    editingKey ? (s.data?.issues.find((i) => i.key === editingKey) ?? null) : null
  );
  const closeEdit = () => editCard(null);

  return (
    <>
      {nameDialog?.mode === "new" && <NewBoardModal onClose={closeNameDialog} />}
      {nameDialog?.mode === "rename" && (
        <BoardNameModal
          boardId={nameDialog.boardId}
          name={nameDialog.name}
          onClose={closeNameDialog}
        />
      )}
      {settingsFor && (
        <BoardSettingsModal
          key={settingsFor.boardKey}
          dialog={settingsFor}
          onClose={() => openSettings(null)}
        />
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
