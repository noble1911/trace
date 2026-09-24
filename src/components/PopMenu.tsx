import { type ReactNode, useCallback, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { I } from "./Icon";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  /** Stable key when `label` isn't a string. */
  id?: string;
  /** Marks the current choice in a pick-one list. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

interface PopMenuProps {
  /** Renders the button that opens the menu. */
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  sections: MenuSection[];
  /** Which edge of the trigger the popover lines up with. */
  align?: "left" | "right";
}

// A trigger plus a small popover of actions, dismissed by an outside click,
// Escape, or picking an item. The one menu primitive behind the header's split
// Start button and ⋯ overflow, and the session tab bar's "+ agent".
export function PopMenu({ trigger, sections, align = "right" }: PopMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, close);
  const visible = sections.filter((s) => s.items.length > 0);

  return (
    <div className="pop-menu" ref={wrapRef}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className={`pop-menu-pop ${align}`} role="menu">
          {visible.map((section, i) => (
            <div key={section.title ?? i} className="pop-menu-section">
              {section.title && <div className="pop-menu-head">{section.title}</div>}
              {section.items.map((item, j) => (
                <button
                  key={item.id ?? (typeof item.label === "string" ? item.label : j)}
                  type="button"
                  role="menuitem"
                  className={`pop-menu-item${item.danger ? " danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="check">{item.checked && <I.Check size={12} />}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The ⋯ overflow trigger for `PopMenu` — occasional actions live behind it. */
export function MoreTrigger({ toggle, label }: { toggle: () => void; label: string }) {
  return (
    <button type="button" className="btn icon" onClick={toggle} title={label} aria-label={label}>
      <I.More size={15} />
    </button>
  );
}
