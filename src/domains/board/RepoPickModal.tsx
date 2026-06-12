import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { listRepos, setIssueRepo } from "@/ipc/repos";
import { useBoardStore } from "./store";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// Shown when a board kickoff needs a repo and none can be inferred (multiple
// repos, no assignment, no learned project default). Picking assigns the repo,
// teaches the project default, and retries the kickoff — all without leaving
// the board.
export function RepoPickModal({ issueKey }: { issueKey: string }) {
  const closeRepoPick = useBoardStore((s) => s.closeRepoPick);
  const kickoff = useBoardStore((s) => s.kickoff);
  const [repos, setRepos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listRepos().then(setRepos);
  }, []);

  const pick = async (path: string) => {
    setError(null);
    try {
      await setIssueRepo(issueKey, path);
      closeRepoPick();
      kickoff(issueKey);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <Modal title={`Where does ${issueKey} live?`} onClose={closeRepoPick}>
      <div className="hint" style={{ marginBottom: 4 }}>
        Pick the repository for this ticket. To resolve similar tickets automatically, add a ticket
        mapping in Settings → Repositories.
      </div>
      <div className="repo-pick-list">
        {repos.map((path) => (
          <button
            type="button"
            key={path}
            className="repo-pick-row"
            onClick={() => void pick(path)}
          >
            <I.Code size={13} />
            <span className="name">{basename(path)}</span>
            <span className="path">{path}</span>
          </button>
        ))}
      </div>
      {error && <span style={{ fontSize: 12.5, color: "var(--c-danger)" }}>{error}</span>}
    </Modal>
  );
}
