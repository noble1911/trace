import { useState } from "react";
import { IconButton } from "./IconButton";
import { MenuCaret } from "./MenuCaret";
import { PopMenu } from "./PopMenu";

interface FontFieldProps {
  /** The applied value: a family, or a comma-separated stack. "" means the default. */
  value: string;
  /** Called with a value to apply: a pick from the menu, or what was typed, on Enter or blur. */
  onChange: (next: string) => void;
  /** Families to offer first, each shown in its own face. */
  suggestions: string[];
  /** Every other installed family, listed under "Installed" after the suggestions. */
  installed?: string[];
  /** What a blank value means, for the Default item ("Geist Mono", "Same as code font"). */
  defaultFamily: string;
  label: string;
}

// A font box that takes any family typed into it, plus a button listing every
// suggestion. A <datalist> did this before, but Chromium only lists the options
// matching the current text, so once a font was picked nothing else showed.
//
// What's typed is a draft until Enter or blur: applying per keystroke re-laid
// the whole app in every prefix on the way ("Geist" before "Geist Mono") and
// reconfigured every live terminal. Escape drops the draft. A menu pick applies
// at once.
export function FontField({
  value,
  onChange,
  suggestions,
  installed = [],
  defaultFamily,
  label,
}: FontFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = value.trim();
  const pick = (next: string) => {
    setDraft(null);
    onChange(next);
  };
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() !== current) onChange(draft.trim());
  };
  const item = (family: string) => ({
    id: family,
    label: <span style={{ fontFamily: `"${family}"` }}>{family}</span>,
    checked: current.toLowerCase() === family.toLowerCase(),
    onSelect: () => pick(family),
  });
  const items = [
    {
      id: "default",
      label: <span style={{ fontFamily: `"${defaultFamily}"` }}>Default ({defaultFamily})</span>,
      checked: current === "",
      onSelect: () => pick(""),
    },
    ...suggestions.map(item),
  ];
  const sections =
    installed.length > 0
      ? [{ items }, { title: "Installed", items: installed.map(item) }]
      : [{ items }];
  return (
    <div className="font-field">
      <input
        type="text"
        aria-label={label}
        // One word for "use the default" in every box; the menu names what that is.
        placeholder="Default"
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape" && draft !== null) {
            // Only swallow Escape when it had a draft to drop; otherwise it's the page's.
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
      <PopMenu
        align="right"
        trigger={({ open, toggle }) => (
          <IconButton
            label={`Choose ${label.toLowerCase()}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <MenuCaret />
          </IconButton>
        )}
        sections={sections}
      />
    </div>
  );
}
