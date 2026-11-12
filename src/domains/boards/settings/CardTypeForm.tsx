import { type KeyboardEvent, useId, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { type NamedType, typeNameProblem } from "./cardTypes";

interface CardTypeFormProps {
  /** The type being edited, or none for a new one. */
  initial?: { id: string; name: string; prompt: string | null };
  /** Every type on the board, to keep names unique. */
  types: NamedType[];
  submitLabel: string;
  busyLabel: string;
  /** Resolves true once saved; false keeps the form open (a toast said why). */
  onSubmit: (name: string, prompt: string) => Promise<boolean>;
  onCancel: () => void;
}

// A card type's name and its own prompt, for adding one or editing it in place, in the
// board's settings dialog. Enter in the name saves it; Escape cancels it without closing
// the dialog.
export function CardTypeForm(props: CardTypeFormProps) {
  const { initial, types, submitLabel, busyLabel, onSubmit, onCancel } = props;
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const id = useId();
  const problem = typeNameProblem(name, types, initial?.id);

  const save = async () => {
    setTried(true);
    if (problem || busy) return;
    setBusy(true);
    const ok = await onSubmit(name.trim().replace(/\s+/g, " "), prompt.trim());
    if (!ok) setBusy(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      void save();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Enter/Escape for the fields inside
    <div className="bd-type-form" onKeyDown={onKeyDown}>
      <div className="field">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          // biome-ignore lint/a11y/noAutofocus: the form opens to be typed into
          autoFocus
          value={name}
          aria-invalid={tried && problem !== null}
          onChange={(e) => setName(e.target.value)}
        />
        {tried && problem && <span className="hint bd-problem">{problem}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-prompt`}>Prompt for this type</label>
        <textarea
          id={`${id}-prompt`}
          value={prompt}
          placeholder="Blank uses the board's kickoff prompt"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="bd-form-foot">
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void save()}
        >
          <BusyLabel busy={busy} idle={submitLabel} working={busyLabel} />
        </button>
      </div>
    </div>
  );
}
