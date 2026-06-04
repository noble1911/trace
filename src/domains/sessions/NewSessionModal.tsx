import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import type { AgentCli } from "@/ipc/agent";

interface NewSessionModalProps {
  defaultCli: AgentCli;
  onClose: () => void;
  onCreate: (title: string, cli: AgentCli) => void;
}

// Title + CLI picker for a new exploratory session. Title is optional — the
// backend falls back to "Exploration" when blank.
export function NewSessionModal({ defaultCli, onClose, onCreate }: NewSessionModalProps) {
  const [title, setTitle] = useState("");
  const [cli, setCli] = useState<AgentCli>(defaultCli);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the title field on open (without the lint-flagged autoFocus attribute).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => onCreate(title.trim() || "Exploration", cli);

  return (
    <Modal
      title="New session"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            Create
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">What are you exploring?</span>
        <input
          ref={inputRef}
          className="field-input"
          type="text"
          placeholder="e.g. Spike: try the new parser"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">Agent</span>
        <select
          className="field-input"
          value={cli}
          onChange={(e) => setCli(e.target.value as AgentCli)}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <div className="field-note">
        Runs in your configured repo root — not a worktree — so it shares your working tree.
      </div>
    </Modal>
  );
}
