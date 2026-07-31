import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icon";
import type { AgentCli, AgentProvider } from "@/ipc/agent";

interface AgentOption {
  cli: AgentCli;
  provider?: AgentProvider;
  label: string;
}

const OPTIONS: AgentOption[] = [
  { cli: "claude", label: "claude" },
  { cli: "claude", provider: "moonshot", label: "claude · kimi" },
  { cli: "claude", provider: "fireworks", label: "claude · kimi fast" },
  { cli: "codex", label: "codex" },
];

interface AddAgentMenuProps {
  onAdd: (cli: AgentCli, provider?: AgentProvider) => void;
  /** True at the companion cap — the trigger stays visible but inert. */
  disabled?: boolean;
}

// "+" in the session's tab bar: picks which CLI joins the session's worktree.
// A popover rather than a modal — adding an agent is a one-click decision.
export function AddAgentMenu({ onAdd, disabled }: AddAgentMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape (the menu has no backdrop of its own).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="add-agent" ref={wrapRef}>
      <button
        type="button"
        className="add-agent-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={
          disabled
            ? "This session already has the maximum number of agents"
            : "Add another agent in this session's worktree"
        }
        aria-label="Add an agent to this session"
      >
        <I.Plus size={13} />
      </button>
      {open && (
        <div className="add-agent-menu" role="menu">
          <div className="add-agent-head">Add agent · same worktree</div>
          {OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAdd(opt.cli, opt.provider);
              }}
            >
              <span className={`session-cli ${opt.cli}`}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
