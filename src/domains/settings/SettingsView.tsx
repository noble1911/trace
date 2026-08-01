import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/Switch";
import {
  agentArgsRaw,
  agentCli,
  agentModelRaw,
  agentProvider,
  autoStartOnMove,
  DEFAULT_KICKOFF_PROMPT,
  kickoffPromptRaw,
  notifyOnWaiting,
  setAgentArgs,
  setAgentCli,
  setAgentModel,
  setAgentProvider,
  setAutoStartOnMove,
  setKickoffPrompt,
  setNotifyOnWaiting,
} from "@/domains/agent/defaults";
import { JiraForm, PylonForm } from "@/domains/issues/components/ProviderLogin";
import { useIssuesStore } from "@/domains/issues/store";
import type { ProviderKind } from "@/domains/issues/types";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
import { AssistantSettings } from "./AssistantSettings";
import { ProviderKeyField } from "./ProviderKeyField";
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

// Settings: the local repo agents run in, agent defaults, and the tracker connections.
export function SettingsView() {
  const sessions = useIssuesStore((s) => s.sessions);
  const users = useIssuesStore((s) => s.users);
  const disconnect = useIssuesStore((s) => s.disconnect);
  const [connectingProvider, setConnectingProvider] = useState<ProviderKind | null>(null);

  // Close the connect modal once its provider is live.
  useEffect(() => {
    if (connectingProvider && sessions[connectingProvider]) setConnectingProvider(null);
  }, [connectingProvider, sessions]);

  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [provider, setProvider] = useState<AgentProvider>(agentProvider);
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
  const chooseProvider = (next: AgentProvider) => {
    setProvider(next);
    setAgentProvider(next);
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
              {cli === "claude" && (
                <SettingRow
                  label="Provider"
                  hint="Kimi runs the same Claude Code harness against a third-party API."
                >
                  <select
                    aria-label="Default provider"
                    value={provider}
                    onChange={(e) => chooseProvider(e.target.value as AgentProvider)}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="moonshot">Kimi (Moonshot)</option>
                    <option value="wafer">Kimi (Wafer)</option>
                    <option value="wafer-fast">Kimi Fast (Wafer)</option>
                  </select>
                </SettingRow>
              )}
              {cli === "claude" && provider !== "anthropic" && (
                <ProviderKeyField provider={provider} />
              )}
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
                  {"{summary}"}, {"{description}"}, {"{comments}"} (the ticket's discussion thread,
                  fetched at launch). Blank uses the default.
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

            <AssistantSettings />

            <section className="setting-group">
              <h2>Integrations</h2>
              <div className="desc">Where the board comes from — connect one or both.</div>
              {(["jira", "pylon"] as const).map((kind) => {
                const session = sessions[kind];
                const user = users[kind];
                return (
                  <div className="integration-card" key={kind}>
                    <div className="ig-ic ig-ic-jira">{kind === "pylon" ? "P" : "J"}</div>
                    <div className="ig-body">
                      <div className="ig-name">
                        {kind === "pylon" ? "Pylon" : "Jira"}
                        {session && user ? ` · ${user.displayName}` : ""}
                      </div>
                      <div className="ig-sub">
                        {session
                          ? kind === "pylon"
                            ? "api.usepylon.com"
                            : `${session.site} · ${session.email}`
                          : "Not connected."}
                      </div>
                    </div>
                    {session ? (
                      <button
                        type="button"
                        className="ig-status connected"
                        onClick={() => void disconnect(kind)}
                        title="Disconnect"
                      >
                        connected
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ig-status disconnected"
                        onClick={() => setConnectingProvider(kind)}
                        title="Connect"
                      >
                        connect
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </div>
      {connectingProvider && (
        <Modal
          title={connectingProvider === "jira" ? "Connect Jira" : "Connect Pylon"}
          onClose={() => setConnectingProvider(null)}
        >
          {connectingProvider === "jira" ? <JiraForm /> : <PylonForm />}
        </Modal>
      )}
    </div>
  );
}
