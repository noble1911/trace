import { I } from "./Icon";

interface PanelToggleProps {
  /** What the panel holds, e.g. "Pull requests" — the button says so. */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Optional count shown after the label (e.g. how many PRs). */
  count?: number;
}

// A labelled show/hide button for a side panel: the sidebar glyph plus the
// panel's name, drawn pressed while the panel is open — so it reads as "the
// Pull requests panel, currently shown" rather than a bare chevron.
export function PanelToggle({ label, open, onToggle, count }: PanelToggleProps) {
  return (
    <button
      type="button"
      className={`btn ghost panel-toggle${open ? " on" : ""}`}
      onClick={onToggle}
      aria-pressed={open}
      title={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
    >
      <I.Sidebar size={14} />
      {label}
      {count != null && count > 0 && <span className="count">{count}</span>}
    </button>
  );
}
