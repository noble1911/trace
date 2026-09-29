import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { Modal } from "@/components/Modal";
import { listRepos } from "@/ipc/repos";
import { ShareRow } from "./ShareRow";
import { countLabel } from "./share";
import { useSchedulesStore } from "./store";
import type { ImportItem } from "./types";

interface ImportModalProps {
  /** The file's prompts, each with the repo the backend matched it to. */
  items: ImportItem[];
  onClose: () => void;
}

interface Row extends ImportItem {
  picked: boolean;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const nameKey = (title: string) => title.trim().toLowerCase();

// Preview a shared file before anything is saved: which prompts to keep, and the
// repo each one runs in. They arrive paused. Someone else chose their flags, so
// nothing fires until you've read them and resumed.
export function ImportModal({ items, onClose }: ImportModalProps) {
  const importPrompts = useSchedulesStore((s) => s.importPrompts);
  const existing = useSchedulesStore((s) => s.prompts);
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({ ...item, picked: true })));
  const [repos, setRepos] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRepos().then((all) => {
      if (!cancelled) setRepos(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const taken = new Set(existing.map((p) => nameKey(p.title)));
  const chosen = rows.filter((r) => r.picked);
  const noRepos = repos !== null && repos.length === 0;
  const patchRow = (index: number, next: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...next } : r)));

  const submit = () => {
    setBusy(true);
    setError(null);
    importPrompts(chosen.map(({ shared, repo }) => ({ shared, repo })))
      .then((saved) => {
        toast.success(`Imported ${countLabel(saved.length)}, paused until you resume them`);
        onClose();
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title="Import scheduled prompts"
      onClose={onClose}
      className="share-modal"
      footer={
        <>
          {error && <span className="sched-form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={busy || noRepos || chosen.length === 0}
          >
            Import {countLabel(chosen.length)}
          </button>
        </>
      }
    >
      <p className="share-note">
        {noRepos ? (
          "Add a repository in Settings → Repos first. Each prompt runs in a worktree of one."
        ) : (
          <>
            Imported prompts start <strong>paused</strong>. Read each one's prompt and CLI flags
            before you resume it, because it will run unattended.
          </>
        )}
      </p>
      <div className="share-list">
        {rows.map((row, i) => (
          <ShareRow
            // biome-ignore lint/suspicious/noArrayIndexKey: a file's prompts have no ids, and this list is never reordered
            key={i}
            prompt={row.shared}
            checked={row.picked}
            onToggle={(picked) => patchRow(i, { picked })}
            tag={taken.has(nameKey(row.shared.title)) ? "Name already in use" : null}
          >
            {repos && repos.length > 0 && (
              <select
                className="field-input share-repo"
                value={row.repo ?? ""}
                disabled={!row.picked}
                aria-label={`Repository for ${row.shared.title}`}
                onChange={(e) => patchRow(i, { repo: e.target.value })}
              >
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {basename(r)}
                  </option>
                ))}
              </select>
            )}
          </ShareRow>
        ))}
      </div>
    </Modal>
  );
}
