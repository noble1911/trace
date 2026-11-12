import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import type { Priority } from "@/domains/issues/types";
import {
  type CardDraft,
  type CardDraftFields,
  draftFields,
  draftProblem,
  draftTypeId,
  NO_TYPE,
  PRIORITY_OPTIONS,
} from "./cardDraft";
import { useLoadedCardTypes } from "./settings/useBoardSetup";

interface CardFormProps {
  initial: CardDraft;
  /** The save button's word, and its verb while saving ("Add card" / "Adding…"). */
  submitLabel: string;
  busyLabel: string;
  /** Resolves true once saved; false keeps the form open (the toast said why). */
  onSubmit: (fields: CardDraftFields) => Promise<boolean>;
  onCancel: () => void;
  /** `sm` buttons in a column, `md` in a dialog or the ticket view. */
  size?: "sm" | "md";
}

/** The option picked, as a `Priority` (the select only offers ours). */
const priorityOf = (value: string, fallback: Priority): Priority =>
  PRIORITY_OPTIONS.find((p) => p.value === value)?.value ?? fallback;

// A custom card's fields: summary (required), description, type (when the board has
// types), priority and labels. One form for adding a card in a column, editing it from
// its menu, and in the ticket view. Enter in a one-line field saves; Escape cancels.
export function CardForm(props: CardFormProps) {
  const { initial, submitLabel, busyLabel, onSubmit, onCancel, size = "md" } = props;
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const id = useId();
  const problem = draftProblem(draft);
  // The board on screen's types: every card form is for a card on it.
  const types = useLoadedCardTypes();
  const typeId = draftTypeId(draft, types);
  const set = <K extends keyof CardDraft>(k: K, v: CardDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const btn = size === "sm" ? "btn sm" : "btn";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (problem || busy) return;
    setBusy(true);
    const saved = await onSubmit(draftFields(draft, types));
    // A saved form is usually unmounted by its owner; one that failed stays to retry.
    if (!saved) setBusy(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onCancel();
  };

  return (
    <form className={`bd-card-form ${size}`} onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="field">
        <label htmlFor={`${id}-summary`}>Summary</label>
        <input
          id={`${id}-summary`}
          // biome-ignore lint/a11y/noAutofocus: the form opens to be typed into
          autoFocus
          value={draft.summary}
          aria-invalid={tried && problem !== null}
          onChange={(e) => set("summary", e.target.value)}
        />
        {tried && problem && <span className="hint bd-problem">{problem}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${id}-desc`}>Description</label>
        <textarea
          id={`${id}-desc`}
          value={draft.description}
          placeholder="Markdown"
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="bd-form-row">
        {types.length > 0 && (
          <div className="field">
            <label htmlFor={`${id}-type`}>Type</label>
            <select
              id={`${id}-type`}
              value={typeId ?? NO_TYPE}
              onChange={(e) => set("typeId", e.target.value)}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {/* A new card defaults to the first type, but any card can have none. */}
              <option value={NO_TYPE}>No type</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-priority`}>Priority</label>
          <select
            id={`${id}-priority`}
            value={draft.priority}
            onChange={(e) => set("priority", priorityOf(e.target.value, draft.priority))}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field bd-grow">
          <label htmlFor={`${id}-labels`}>Labels</label>
          <input
            id={`${id}-labels`}
            value={draft.labels}
            placeholder="Comma-separated"
            onChange={(e) => set("labels", e.target.value)}
          />
        </div>
      </div>
      <div className="bd-form-foot">
        <button type="button" className={btn} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={btn} disabled={busy} aria-busy={busy}>
          <BusyLabel busy={busy} idle={submitLabel} working={busyLabel} />
        </button>
      </div>
    </form>
  );
}
