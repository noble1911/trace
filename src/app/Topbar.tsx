import type { ReactNode } from "react";
import { NAV_LABELS, type NavId } from "./nav";
import { SearchPalette } from "./SearchPalette";

interface TopbarProps {
  nav: NavId;
  project: string;
  /** Right-aligned actions slot (e.g. board picker + refresh). */
  extra?: ReactNode;
}

/** Views that show the selected board's data — only they name it in the crumbs. */
const BOARD_SCOPED = new Set<NavId>(["board", "pr"]);

export function Topbar({ nav, project, extra }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="crumbs">
        <span>trace</span>
        <span className="sep">/</span>
        {BOARD_SCOPED.has(nav) && (
          <>
            <span className="project">{project}</span>
            <span className="sep">/</span>
          </>
        )}
        <span>{NAV_LABELS[nav]}</span>
      </div>
      <SearchPalette />
      <div className="actions">{extra}</div>
    </header>
  );
}
