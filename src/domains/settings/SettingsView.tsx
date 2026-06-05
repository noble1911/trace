import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useJiraStore } from "@/domains/jira/store";
import { type AgentCli, getRepoPath, setRepoPath } from "@/ipc/agent";

const CLI_KEY = "trace.agentCli";
const MODEL_KEY = "trace.agentModel";

function read(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

// Settings: the local repo agents run in, agent defaults, and the Jira connection.
export function SettingsView() {
  const session = useJiraStore((s) => s.session);
  const user = useJiraStore((s) => s.user);
  const disconnect = useJiraStore((s) => s.disconnect);

  const [repo, setRepo] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cli, setCli] = useState<AgentCli>(read(CLI_KEY) === "codex" ? "codex" : "claude");
  const [model, setModel] = useState(read(MODEL_KEY));

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    write(CLI_KEY, next);
  };
  const chooseModel = (next: string) => {
    setModel(next);
    write(MODEL_KEY, next.trim());
  };

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
            <h2>Agent</h2>
            <div className="desc">Defaults applied when you start a new coding session.</div>
            <div className="field">
              <label htmlFor="default-cli">Default agent</label>
              <select
                id="default-cli"
                value={cli}
                onChange={(e) => chooseCli(e.target.value as AgentCli)}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <span className="hint">
                Pre-selected when starting a board or exploratory session.
              </span>
            </div>
            <div className="field">
              <label htmlFor="default-model">Default model</label>
              <input
                id="default-model"
                placeholder="e.g. opus, sonnet — blank uses the CLI default"
                value={model}
                onChange={(e) => chooseModel(e.target.value)}
              />
              <span className="hint">
                Passed to Claude as <code>--model</code>. Leave blank to use the CLI's default.
              </span>
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
                <div className="ig-name">Jira{user ? ` · ${user.displayName}` : ""}</div>
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
