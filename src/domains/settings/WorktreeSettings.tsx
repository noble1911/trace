import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { listWorktrees, removeWorktree, type WorktreeInfo } from "@/ipc/worktrees";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// Worktree housekeeping: every .worktrees/ checkout across the configured
// repos, with merged/dirty/running status and one-click removal. Dirty
// worktrees need a confirm (removal discards uncommitted work).
export function WorktreeSettings() {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const refresh = () => {
    setScanning(true);
    void listWorktrees()
      .then(setWorktrees)
      .finally(() => setScanning(false));
  };
  useEffect(refresh, []);

  const remove = async (wt: WorktreeInfo) => {
    setError(null);
    if (wt.dirty) {
      const ok = await confirm(
        `${wt.name} has uncommitted changes that will be lost. Remove it anyway?`,
        { title: "Remove worktree", kind: "warning" }
      );
      if (!ok) return;
    }
    setBusy(wt.path);
    try {
      await removeWorktree(wt.repo, wt.path, wt.branch, wt.dirty);
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  // Clean, merged, idle worktrees — the no-questions-asked bulk target.
  const removable = worktrees.filter((wt) => wt.merged && !wt.dirty && !wt.running);
  const removeMerged = async () => {
    setError(null);
    setBusy("*");
    try {
      for (const wt of removable) {
        await removeWorktree(wt.repo, wt.path, wt.branch, false);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return (
    <section className="setting-group">
      <h2>Worktrees</h2>
      <div className="desc">
        Each ticket's agent works in an isolated checkout under .worktrees/. Merged ones can be
        removed (their branch is deleted too).
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn" onClick={refresh} disabled={busy !== null}>
          Refresh
        </button>
        {removable.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => void removeMerged()}
            disabled={busy !== null}
          >
            <I.Check size={13} /> Remove {removable.length} merged
          </button>
        )}
      </div>
      {worktrees.length === 0 ? (
        <span className="hint">
          {scanning ? "Scanning repositories…" : "No worktrees right now."}
        </span>
      ) : (
        <div className="repo-list">
          {worktrees.map((wt) => (
            <div key={wt.path} className="repo-row">
              <I.Branch size={14} />
              <span className="repo-name">{wt.name}</span>
              <span className="repo-path">{basename(wt.repo)}</span>
              {wt.running && <span className="wt-chip running">running</span>}
              {wt.merged && <span className="wt-chip merged">merged</span>}
              {wt.dirty && <span className="wt-chip dirty">uncommitted</span>}
              <button
                type="button"
                className="repo-remove"
                onClick={() => void remove(wt)}
                disabled={wt.running || busy === wt.path}
                aria-label={`Remove worktree ${wt.name}`}
                title={wt.running ? "Stop the agent first" : "Remove worktree + branch"}
              >
                <I.X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <span style={{ fontSize: 12.5, color: "var(--c-danger)", marginTop: 8, display: "block" }}>
          {error}
        </span>
      )}
    </section>
  );
}
