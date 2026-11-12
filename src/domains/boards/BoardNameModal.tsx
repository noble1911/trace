import { type FormEvent, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { Modal } from "@/components/Modal";
import { createBoard, renameBoard } from "./boardList";
import { cleanName } from "./columns";
import type { NameDialog } from "./uiStore";

interface BoardNameModalProps {
  dialog: NameDialog;
  onClose: () => void;
}

// "New board…" and "Rename board…": one field, the board's name. A new board starts
// with To do / In progress / Done, which the dialog says so it's no surprise.
export function BoardNameModal({ dialog, onClose }: BoardNameModalProps) {
  const isNew = dialog.mode === "new";
  const [name, setName] = useState(isNew ? "" : dialog.name);
  const [busy, setBusy] = useState(false);
  const clean = cleanName(name);
  const unchanged = !isNew && clean === dialog.name;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!clean || busy) return;
    if (unchanged) return onClose();
    setBusy(true);
    const ok = isNew ? await createBoard(clean) : await renameBoard(dialog.boardId, clean);
    if (ok) onClose();
    else setBusy(false);
  };

  return (
    <Modal
      title={isNew ? "New board" : "Rename board"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="bd-name-form"
            className="btn primary"
            disabled={!clean || busy}
            aria-busy={busy}
          >
            {isNew ? (
              <BusyLabel busy={busy} idle="Make board" working="Making…" />
            ) : (
              <BusyLabel busy={busy} idle="Rename" working="Renaming…" />
            )}
          </button>
        </>
      }
    >
      <form id="bd-name-form" className="field" onSubmit={submit}>
        <label htmlFor="bd-name">Name</label>
        <input
          id="bd-name"
          // biome-ignore lint/a11y/noAutofocus: the dialog exists for this one field
          autoFocus
          value={name}
          placeholder={isNew ? "e.g. Side projects" : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {isNew && (
          <span className="hint">
            It starts with To do, In progress and Done. Cards you add here start agents like any
            ticket.
          </span>
        )}
      </form>
    </Modal>
  );
}
