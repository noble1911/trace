import type { ReactNode } from "react";
import { I } from "./Icon";

/** One thing the panel can show — "Pull requests", "Orchestrator". */
export interface SideView {
  id: string;
  label: string;
  /** Shown beside the label (how many PRs, say). */
  count?: number;
  content: ReactNode;
}

interface SidePanelProps {
  views: SideView[];
  /** The view showing (or that would show on opening). */
  active: string;
  open: boolean;
  /** Open the panel on a view (also switches views while open). */
  onShow: (id: string) => void;
  onClose: () => void;
}

const counted = (n?: number): n is number => n != null && n > 0;

/**
 * The right-edge panel: context for what's on screen, one view at a time. It
 * slides in from the side; closed, it folds to a slim strip naming each view —
 * clicking a name opens that view, so the header needs no toggle. Render it as
 * the last child of a `.detail` or `.main`, which makes room for it
 * (side-panel.css). State comes from `useSidePanel`.
 */
export function SidePanel({ views, active, open, onShow, onClose }: SidePanelProps) {
  const current = views.find((v) => v.id === active) ?? views[0];
  if (!current) return null;
  if (!open) {
    return (
      <aside className="side-panel" aria-label="Side panel">
        <div className="sp-strip">
          <span className="sp-strip-icon" aria-hidden="true">
            <I.Sidebar size={14} />
          </span>
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className="sp-strip-item"
              onClick={() => onShow(v.id)}
              aria-label={`Show ${v.label.toLowerCase()}`}
              title={`Show ${v.label.toLowerCase()}`}
            >
              {/* Reads bottom-to-top like a book's spine. */}
              <span className="sp-strip-label">{v.label}</span>
              {counted(v.count) && <span className="sp-count">{v.count}</span>}
            </button>
          ))}
        </div>
      </aside>
    );
  }
  return (
    <aside className="side-panel open" aria-label={current.label}>
      <div className="sp-head">
        {views.length === 1 ? (
          <span className="sp-title">
            {current.label}
            {counted(current.count) && <span className="sp-count">{current.count}</span>}
          </span>
        ) : (
          <div className="sp-tabs" role="tablist">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === current.id}
                className={`sp-tab${v.id === current.id ? " on" : ""}`}
                onClick={() => onShow(v.id)}
              >
                {v.label}
                {counted(v.count) && <span className="sp-count">{v.count}</span>}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn icon"
          onClick={onClose}
          title="Hide panel"
          aria-label="Hide panel"
        >
          <I.Sidebar size={14} />
        </button>
      </div>
      <div className="sp-body">{current.content}</div>
    </aside>
  );
}
