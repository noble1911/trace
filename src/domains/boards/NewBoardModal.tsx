import { type FormEvent, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { Modal } from "@/components/Modal";
import { Segmented } from "@/components/Segmented";
import { createBoard } from "./boardList";
import { cleanName } from "./columns";
import { RepoPicker } from "./settings/RepoPicker";
import type { BoardRepos } from "./settings/repoChoice";
import { TEMPLATES, type TemplateId, templateById, templateSummary } from "./templates";

const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({ value: t.id, label: t.label }));

// "New board…": one dialog for what a board is. Its name; a template (its columns, card
// types and brief, shown in a line); and the repos its cards start in. Everything here
// can be changed later: columns on the board, the rest in its Board settings.
export function NewBoardModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("software");
  const [repos, setRepos] = useState<BoardRepos>({ repos: [], defaultRepo: null });
  const [busy, setBusy] = useState(false);
  const clean = cleanName(name);
  const template = templateById(templateId);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    const ok = await createBoard(clean, template, repos);
    if (ok) onClose();
    else setBusy(false);
  };

  return (
    <Modal
      title="New board"
      onClose={onClose}
      className="bd-setup-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="bd-new-form"
            className="btn primary"
            disabled={!clean || busy}
            aria-busy={busy}
          >
            <BusyLabel busy={busy} idle="Make board" working="Making…" />
          </button>
        </>
      }
    >
      <form id="bd-new-form" className="bd-setup-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bd-new-name">Name</label>
          <input
            id="bd-new-name"
            // biome-ignore lint/a11y/noAutofocus: the dialog opens to be typed into
            autoFocus
            value={name}
            placeholder="e.g. Side projects"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="bd-field-label">Template</span>
          <Segmented
            label="Template"
            value={templateId}
            options={TEMPLATE_OPTIONS}
            onChange={setTemplateId}
          />
          <span className="hint bd-template-line">{templateSummary(template)}</span>
          <span className="hint">
            {template.prompt
              ? "Comes with a kickoff prompt for its cards' agents."
              : "Its cards' agents get the kickoff prompt from Settings."}
          </span>
        </div>
        <div className="field">
          <span className="bd-field-label">Repositories</span>
          <RepoPicker label="Repositories" value={repos} onChange={setRepos} />
          <span className="hint">
            Cards start their agents here. None: each card's repository is decided as it is on any
            board. Several with no default: Start asks.
          </span>
        </div>
      </form>
    </Modal>
  );
}
