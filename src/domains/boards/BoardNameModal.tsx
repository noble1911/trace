import { type FormEvent, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { Modal } from "@/components/Modal";
import { renameBoard } from "./boardList";
import { cleanName } from "./columns";

interface BoardNameModalProps {
  boardId: string;
  name: string;
  onClose: () => void;
}

// "Rename board…": one field, the board's name. Making a board is `NewBoardModal`.
export function BoardNameModal({ boardId, name: current, onClose }: BoardNameModalProps) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const clean = cleanName(name);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!clean || busy) return;
    if (clean === current) return onClose();
    setBusy(true);
    if (await renameBoard(boardId, clean)) onClose();
    else setBusy(false);
  };

  return (
    <Modal
      title="Rename board"
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
            <BusyLabel busy={busy} idle="Rename" working="Renaming…" />
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
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}
