import { useState } from "react";
import { Switch } from "@/components/Switch";
import {
  agentArgsRaw,
  agentCli,
  agentModelRaw,
  autoStartOnMove,
  DEFAULT_KICKOFF_PROMPT,
  kickoffPromptRaw,
  notifyOnWaiting,
  setAgentArgs,
  setAgentCli,
  setAgentModel,
  setAutoStartOnMove,
  setKickoffPrompt,
  setNotifyOnWaiting,
} from "@/domains/agent/defaults";
import { useJiraStore } from "@/domains/jira/store";
import type { AgentCli } from "@/ipc/agent";
import { RepoSettings } from "./RepoSettings";
import { SettingRow } from "./SettingRow";
import { TerminalSettings } from "./TerminalSettings";
import { UpdateSettings } from "./UpdateSettings";
import { WorktreeSettings } from "./WorktreeSettings";

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

  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [model, setModel] = useState(agentModelRaw);
  const [args, setArgs] = useState(agentArgsRaw);
  const [notifyWaiting, setNotifyWaiting] = useState(notifyOnWaiting);
  const [kickoff, setKickoff] = useState(kickoffPromptRaw);
  const [autoStart, setAutoStart] = useState(autoStartOnMove);
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
  const chooseKickoff = (next: string) => {
    setKickoff(next);
    setKickoffPrompt(next);
  };
  const chooseAutoStart = (next: boolean) => {
    setAutoStart(next);
    setAutoStartOnMove(next);
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
            <RepoSettings />

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
              <SettingRow
                label="Auto-start on move"
                hint="Dragging a card to In Progress starts its agent with the kickoff prompt."
              >
                <Switch
                  on={autoStart}
                  onChange={chooseAutoStart}
                  label="Auto-start agents on move to In Progress"
                />
              </SettingRow>
              <div className="setting-block">
                <div className="label">Kickoff prompt</div>
                <div className="hint">
                  Sent to the agent when you start it from the board (the ✦ button on a card, or —
                  with auto-start on — dragging to In&nbsp;Progress). Placeholders: {"{key}"},{" "}
                  {"{summary}"}, {"{description}"}. Blank uses the default.
                </div>
                <textarea
                  aria-label="Kickoff prompt"
                  rows={4}
                  placeholder={DEFAULT_KICKOFF_PROMPT}
                  value={kickoff}
                  onChange={(e) => chooseKickoff(e.target.value)}
                />
              </div>
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
