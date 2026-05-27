import type { ReactNode } from "react";
import { I } from "@/components/Icon";
import { NAV_LABELS, type NavId } from "./nav";

interface TopbarProps {
  nav: NavId;
  project: string;
  /** Right-aligned actions slot (e.g. board picker + refresh). */
  extra?: ReactNode;
}

export function Topbar({ nav, project, extra }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="crumbs">
        <span>trace</span>
        <span className="sep">/</span>
        <span className="project">{project}</span>
        <span className="sep">/</span>
        <span>{NAV_LABELS[nav]}</span>
      </div>
      <div className="search">
        <I.Search size={13} />
        <input placeholder="Search issues, agents, files…" />
        <kbd>⌘ /</kbd>
      </div>
      <div className="actions">{extra}</div>
    </header>
  );
}
