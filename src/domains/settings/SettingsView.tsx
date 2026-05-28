import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useJiraStore } from "@/domains/jira/store";
import { getRepoPath, setRepoPath } from "@/ipc/agent";

// Minimal settings: the local repo agents run in, plus the Jira connection.
export function SettingsView() {
  const session = useJiraStore((s) => s.session);
  const disconnect = useJiraStore((s) => s.disconnect);

  const [repo, setRepo] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getRepoPath().then((p) => {
      setSaved(p);
      if (p) setRepo(p);
    });
  }, []);

  const save = async () => {
    setMessage(null);
    try {
      await setRepoPath(repo.trim());
      setSaved(repo.trim());
      setMessage("Saved.");
    } catch (err) {
      setMessage(String(err));
    }
  };

  const pickFolder = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose a git repository",
    });
    if (typeof picked === "string") setRepo(picked);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="desc">Workspace defaults for trace.</div>
        </div>
      </div>
      <div className="page-body">
        <div className="settings-wrap">
          <section className="setting-group">
            <h2>Repository</h2>
            <div className="desc">
              Agents run in isolated worktrees created under this git repository.
            </div>
            <div className="field">
              <label htmlFor="repo-path">Local repository path</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="repo-path"
                  placeholder="/Users/you/code/your-repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn" onClick={pickFolder}>
                  Choose folder…
                </button>
              </div>
              <span className="hint">
                {saved
                  ? `Current: ${saved}`
                  : "Pick the folder of a git repository on your machine (not a GitHub URL)."}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" className="btn primary" onClick={save} disabled={!repo.trim()}>
                Save repository
              </button>
              {message && <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{message}</span>}
            </div>
          </section>

          <section className="setting-group">
            <h2>Integrations</h2>
            <div className="desc">Where the board comes from.</div>
            <div className="integration-card">
              <div
                className="ig-ic"
                style={{
                  background: "linear-gradient(135deg, oklch(0.55 0.18 250), oklch(0.4 0.18 250))",
                }}
              >
                J
              </div>
              <div className="ig-body">
                <div className="ig-name">Jira</div>
                <div className="ig-sub">
                  {session ? `${session.site} · ${session.email}` : "Not connected."}
                </div>
              </div>
              {session ? (
                <button
                  type="button"
                  className="ig-status disconnected"
                  onClick={() => void disconnect()}
                >
                  disconnect
                </button>
              ) : (
                <span className="ig-status disconnected">connect</span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
