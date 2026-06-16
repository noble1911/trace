import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import type { AgentCli } from "@/ipc/agent";
import { listRepos } from "@/ipc/repos";

interface NewSessionModalProps {
  defaultCli: AgentCli;
  onClose: () => void;
  onCreate: (title: string, cli: AgentCli, repo: string | null) => void;
}

// Show the repo's folder name, not its full path — matches the board's picker.
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// Title + agent + repository picker for a new exploratory session. Title is
// optional (the backend falls back to "Exploration" when blank); the session
// runs in an isolated worktree of the chosen repo.
export function NewSessionModal({ defaultCli, onClose, onCreate }: NewSessionModalProps) {
  const [title, setTitle] = useState("");
  const [cli, setCli] = useState<AgentCli>(defaultCli);
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the title field on open (without the lint-flagged autoFocus attribute).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load configured repos and default the picker to the first one.
  useEffect(() => {
    let cancelled = false;
    void listRepos().then((all) => {
      if (cancelled) return;
      setRepos(all);
      setRepo(all[0] ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = () => onCreate(title.trim() || "Exploration", cli, repo || null);

  return (
    <Modal
      title="New session"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={!repo}>
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
            if (e.key === "Enter" && repo) submit();
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
      {repos.length === 0 ? (
        <div className="field">
          <span className="field-label">Repository</span>
          <div className="field-note">
            No repositories configured — add one in Settings → Repos.
          </div>
        </div>
      ) : (
        <label className="field">
          <span className="field-label">Repository</span>
          <select className="field-input" value={repo} onChange={(e) => setRepo(e.target.value)}>
            {repos.map((r) => (
              <option key={r} value={r}>
                {basename(r)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field-note">Runs in an isolated worktree of the selected repository.</div>
    </Modal>
  );
}
