import { useRef, useState } from "react";
import { updateColumn } from "./boardEdits";
import { cleanName } from "./columns";

interface ColumnNameFieldProps {
  columnId: string;
  name: string;
  onDone: () => void;
}

// A column's name, as a field while it's renamed: Enter or leaving it saves, Escape
// puts the old name back. An empty or unchanged name saves nothing.
export function ColumnNameField({ columnId, name, onDone }: ColumnNameFieldProps) {
  const [value, setValue] = useState(name);
  const settled = useRef(false);

  const save = async () => {
    if (settled.current) return;
    settled.current = true;
    const clean = cleanName(value);
    if (clean && clean !== name) await updateColumn(columnId, { name: clean });
    onDone();
  };

  return (
    <input
      className="bd-col-input"
      aria-label="Column name"
      // biome-ignore lint/a11y/noAutofocus: opened from "Rename" to be typed into
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          settled.current = true;
          onDone();
        }
      }}
    />
  );
}
