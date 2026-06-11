import { useState } from "react";

interface TitleEditorProps {
  initial: string;
  onSave: (title: string) => void;
  onClose: () => void;
}

// Inline rename input. Enter saves, Escape cancels, blur saves. Key/click
// events don't propagate — the session card is itself clickable, and a
// bubbled Enter would open it mid-rename.
export function TitleEditor({ initial, onSave, onClose }: TitleEditorProps) {
  const [draft, setDraft] = useState(initial);

  const commit = () => {
    const title = draft.trim();
    if (title && title !== initial) onSave(title);
    onClose();
  };

  return (
    <input
      className="title-edit"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onClose();
      }}
      onBlur={commit}
      // biome-ignore lint/a11y/noAutofocus: the input replaces the title the user just chose to edit
      autoFocus
      aria-label="Session name"
    />
  );
}
