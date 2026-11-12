import { type FormEvent, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import type { StatusCategory } from "@/domains/issues/types";
import { addColumn } from "./boardEdits";
import { CATEGORIES, CATEGORY_LABELS, cleanName } from "./columns";

// The end of a custom board: a slim "Add column" that opens, in place, a column-wide
// form for its name and category. The category is what the column means (to do, in
// progress, done), so landing in the first in-progress one can start an agent.
export function AddColumn() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("indeterminate");
  const [busy, setBusy] = useState(false);
  const clean = cleanName(name);

  const close = () => {
    setOpen(false);
    setName("");
    setCategory("indeterminate");
    setBusy(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || busy) return;
    setBusy(true);
    if (await addColumn(clean, category)) close();
    else setBusy(false);
  };

  if (!open) {
    return (
      <button type="button" className="btn sm bd-add-col" onClick={() => setOpen(true)}>
        <I.Plus size={14} /> Add column
      </button>
    );
  }
  return (
    <form
      className="column bd-add-col-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
    >
      <div className="field">
        <label htmlFor="bd-new-col">Column name</label>
        <input
          id="bd-new-col"
          // biome-ignore lint/a11y/noAutofocus: opened to be typed into
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="bd-field-label">Means</span>
        <Segmented<StatusCategory>
          label="What the column means"
          value={category}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          onChange={setCategory}
        />
      </div>
      <div className="bd-form-foot">
        <button type="button" className="btn sm" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn sm" disabled={!clean || busy} aria-busy={busy}>
          <BusyLabel busy={busy} idle="Add column" working="Adding…" />
        </button>
      </div>
    </form>
  );
}
