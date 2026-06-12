import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import {
  addRepo,
  listRepoMappings,
  listRepos,
  type RepoMapping,
  removeRepo,
  setRepoMappings,
} from "@/ipc/repos";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// The Repositories section: the configured repos plus the ticket→repo mapping
// table. A ticket whose key contains a mapping's pattern (case-insensitive)
// resolves to that repo; first match wins. Incomplete rows (empty pattern)
// live only in the editor — the backend drops them from disk until filled in.
type EditorRow = RepoMapping & { id: string };

const withId = (m: RepoMapping): EditorRow => ({ ...m, id: crypto.randomUUID() });

export function RepoSettings() {
  const [repos, setRepos] = useState<string[]>([]);
  const [mappings, setMappings] = useState<EditorRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listRepos().then(setRepos);
    void listRepoMappings().then((list) => setMappings(list.map(withId)));
  }, []);

  const persist = (next: EditorRow[]) => {
    setMappings(next);
    void setRepoMappings(next.map(({ pattern, repo }) => ({ pattern, repo }))).catch((err) =>
      setMessage(String(err))
    );
  };

  const addFolder = async () => {
    setMessage(null);
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose a git repository",
    });
    if (typeof picked !== "string") return;
    try {
      setRepos(await addRepo(picked));
    } catch (err) {
      setMessage(String(err));
    }
  };

  const remove = async (path: string) => {
    setMessage(null);
    try {
      setRepos(await removeRepo(path));
      persist(mappings.filter((m) => m.repo !== path));
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <section className="setting-group">
      <h2>Repositories</h2>
      <div className="desc">
        The git repos your tickets live in. Agents run in isolated worktrees under the resolved
        repo.
      </div>
      {repos.length > 0 && (
        <div className="repo-list">
          {repos.map((path) => (
            <div key={path} className="repo-row">
              <I.Code size={14} />
              <span className="repo-name">{basename(path)}</span>
              <span className="repo-path">{path}</span>
              <button
                type="button"
                className="repo-remove"
                onClick={() => void remove(path)}
                aria-label={`Remove ${basename(path)}`}
              >
                <I.X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button type="button" className="btn" onClick={addFolder}>
          <I.Plus size={13} /> Add repository
        </button>
        {message && <span style={{ fontSize: 12.5, color: "var(--c-danger)" }}>{message}</span>}
      </div>
      {repos.length === 0 && (
        <span className="hint" style={{ marginTop: 8, display: "block" }}>
          Add the folder of a local git repository (not a GitHub URL).
        </span>
      )}

      {repos.length > 1 && (
        <div className="setting-block">
          <div className="label">Ticket mapping</div>
          <div className="hint">
            Tickets whose key contains the pattern use that repository (first match wins). Tickets
            with no match ask once and remember the answer per ticket.
          </div>
          {mappings.map((m, i) => (
            <div key={m.id} className="map-row">
              <input
                type="text"
                aria-label="Ticket pattern"
                placeholder="e.g. TRACE"
                value={m.pattern}
                onChange={(e) =>
                  persist(mappings.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))
                }
              />
              <span className="map-arrow">→</span>
              <select
                aria-label="Mapped repository"
                value={m.repo}
                onChange={(e) =>
                  persist(mappings.map((x, j) => (j === i ? { ...x, repo: e.target.value } : x)))
                }
              >
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {basename(r)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="repo-remove"
                onClick={() => persist(mappings.filter((_, j) => j !== i))}
                aria-label="Remove mapping"
              >
                <I.X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="sec-add"
            onClick={() => persist([...mappings, withId({ pattern: "", repo: repos[0] ?? "" })])}
          >
            <I.Plus size={12} /> Add mapping
          </button>
        </div>
      )}
    </section>
  );
}
