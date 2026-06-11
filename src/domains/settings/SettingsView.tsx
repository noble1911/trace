import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { Switch } from "@/components/Switch";
import {
  agentArgsRaw,
  agentCli,
  agentModelRaw,
  notifyOnWaiting,
  setAgentArgs,
  setAgentCli,
  setAgentModel,
  setNotifyOnWaiting,
} from "@/domains/agent/defaults";
import { useJiraStore } from "@/domains/jira/store";
import type { AgentCli } from "@/ipc/agent";
import { addRepo, listRepos, removeRepo } from "@/ipc/repos";
import { SettingRow } from "./SettingRow";
import { TerminalSettings } from "./TerminalSettings";
import { UpdateSettings } from "./UpdateSettings";
import { WorktreeSettings } from "./WorktreeSettings";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

type SettingsTab = "general" | "terminal" | "worktrees" | "updates";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "terminal", label: "Terminal" },
  { id: "worktrees", label: "Worktrees" },
  { id: "updates", label: "Updates" },
];

// Settings: the local repo agents run in, agent defaults, and the Jira connection.
export function SettingsView() {
  const session = useJiraStore((s) => s.session);
  const user = useJiraStore((s) => s.user);
  const disconnect = useJiraStore((s) => s.disconnect);

  const [repos, setRepos] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [model, setModel] = useState(agentModelRaw);
  const [args, setArgs] = useState(agentArgsRaw);
  const [notifyWaiting, setNotifyWaiting] = useState(notifyOnWaiting);
  const [tab, setTab] = useState<SettingsTab>("general");

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    setAgentCli(next);
  };
  const chooseModel = (next: string) => {
    setModel(next);
    setAgentModel(next);
  };
  const chooseArgs = (next: string) => {
    setArgs(next);
    setAgentArgs(next);
  };
  const chooseNotifyWaiting = (next: boolean) => {
    setNotifyWaiting(next);
    setNotifyOnWaiting(next);
  };

  useEffect(() => {
    void listRepos().then(setRepos);
  }, []);

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
    } catch (err) {
      setMessage(String(err));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="desc">Workspace defaults for trace.</div>
        </div>
      </div>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="page-body">
        {tab === "terminal" && (
          <div className="settings-wrap">
            <TerminalSettings />
          </div>
        )}
        {tab === "worktrees" && (
          <div className="settings-wrap">
            <WorktreeSettings />
          </div>
        )}
        {tab === "updates" && (
          <div className="settings-wrap">
            <UpdateSettings />
          </div>
        )}
        {tab === "general" && (
          <div className="settings-wrap">
            <section className="setting-group">
              <h2>Repositories</h2>
              <div className="desc">
                The git repos your tickets live in. Each ticket is assigned one when you start work
                on it; agents run in isolated worktrees under that repo.
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
                {message && (
                  <span style={{ fontSize: 12.5, color: "var(--c-danger)" }}>{message}</span>
                )}
              </div>
              {repos.length === 0 && (
                <span className="hint" style={{ marginTop: 8, display: "block" }}>
                  Add the folder of a local git repository (not a GitHub URL).
                </span>
              )}
            </section>

            <section className="setting-group">
              <h2>Agent defaults</h2>
              <div className="desc">Applied when you start a new coding session.</div>
              <SettingRow label="Default agent" hint="Pre-selected when starting a session.">
                <select
                  aria-label="Default agent"
                  value={cli}
                  onChange={(e) => chooseCli(e.target.value as AgentCli)}
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </SettingRow>
              <SettingRow
                label="Default model"
                hint="Passed as --model. Blank uses the CLI default."
              >
                <input
                  type="text"
                  aria-label="Default model"
                  placeholder="e.g. opus, sonnet"
                  value={model}
                  onChange={(e) => chooseModel(e.target.value)}
                />
              </SettingRow>
              <SettingRow label="Extra arguments" hint="Appended verbatim, split on spaces.">
                <input
                  type="text"
                  aria-label="Extra arguments"
                  placeholder="e.g. --dangerously-skip-permissions"
                  value={args}
                  onChange={(e) => chooseArgs(e.target.value)}
                />
              </SettingRow>
            </section>

            <section className="setting-group">
              <h2>Notifications</h2>
              <div className="desc">How trace gets your attention outside the app.</div>
              <SettingRow
                label="When an agent needs me"
                hint="Native notification when a session finishes its turn while you're elsewhere."
              >
                <Switch
                  on={notifyWaiting}
                  onChange={chooseNotifyWaiting}
                  label="Notify when waiting"
                />
              </SettingRow>
            </section>

            <section className="setting-group">
              <h2>Integrations</h2>
              <div className="desc">Where the board comes from.</div>
              <div className="integration-card">
                <div className="ig-ic ig-ic-jira">J</div>
                <div className="ig-body">
                  <div className="ig-name">Jira{user ? ` · ${user.displayName}` : ""}</div>
                  <div className="ig-sub">
                    {session ? `${session.site} · ${session.email}` : "Not connected."}
                  </div>
                </div>
                {session ? (
                  <button
                    type="button"
                    className="ig-status connected"
                    onClick={() => void disconnect()}
                    title="Disconnect"
                  >
                    connected
                  </button>
                ) : (
                  <span className="ig-status disconnected">connect</span>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
