import { useState } from "react";
import { Switch } from "@/components/Switch";
import {
  agentArgsRaw,
  agentCli,
  agentHost,
  agentModelRaw,
  agentProvider,
  agentTransport,
  autoStartOnMove,
  setAgentArgs,
  setAgentCli,
  setAgentHost,
  setAgentModel,
  setAgentProvider,
  setAgentTransport,
  setAutoStartOnMove,
} from "@/domains/agent/defaults";
import { useHasChat } from "@/domains/agentChat/transport";
import { useVercelStatus } from "@/domains/vercel/store";
import type { AgentCli, AgentProvider, RunsOn, Transport } from "@/ipc/agent";
import { KeepAwakeSettings } from "./KeepAwakeSettings";
import { ProviderKeyField } from "./ProviderKeyField";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";

/** Why the provider's rows don't apply with Codex chosen. */
const CLAUDE_ONLY = "Applies when Default agent is Claude.";

// What a new agent starts with: harness, provider, model, arguments. (The kickoff
// brief is on the Prompts tab.) Provider and its key stay on the page whatever is
// chosen, inactive with the reason when they don't apply, so nothing jumps.
export function AgentDefaultsSettings() {
  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [provider, setProvider] = useState<AgentProvider>(agentProvider);
  const [model, setModel] = useState(agentModelRaw);
  const [args, setArgs] = useState(agentArgsRaw);
  const [autoStart, setAutoStart] = useState(autoStartOnMove);
  const [transport, setTransport] = useState<Transport>(agentTransport);
  const [host, setHost] = useState<RunsOn>(agentHost);
  const codexChat = useHasChat("codex");
  const vercel = useVercelStatus();

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
  const chooseTransport = (next: Transport) => {
    setTransport(next);
    setAgentTransport(next);
  };
  const chooseHost = (next: RunsOn) => {
    setHost(next);
    setAgentHost(next);
  };
  const chooseAutoStart = (next: boolean) => {
    setAutoStart(next);
    setAutoStartOnMove(next);
  };

  return (
    <>
      <SettingSection title="New agents" desc="Applied when you start a new coding session.">
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
          label="Provider"
          hint="Third-party providers run the same Claude Code harness against their API."
          inactive={cli !== "claude"}
          inactiveReason={CLAUDE_ONLY}
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
            <option value="deepseek">DeepSeek Flash</option>
            <option value="deepseek-pro">DeepSeek Pro</option>
          </select>
        </SettingRow>
        <ProviderKeyField
          provider={provider}
          inactiveReason={cli !== "claude" ? CLAUDE_ONLY : undefined}
        />
        <SettingRow
          label="Shows as"
          hint={`Chat shows the agent as a formatted conversation, Terminal as its own TUI. A ticket or session can pick the other when it starts, and keeps its choice.${codexChat ? "" : " Codex has no chat view yet, so it always runs in a terminal."}`}
        >
          <select
            aria-label="Show agents as"
            value={transport}
            onChange={(e) => chooseTransport(e.target.value as Transport)}
          >
            <option value="chat">Chat</option>
            <option value="terminal">Terminal</option>
          </select>
        </SettingRow>
        {vercel && (
          <SettingRow
            label="Runs on"
            hint="Where ticket agents start, auto-start and the orchestrator's start_agent included. A Vercel sandbox clones the ticket's repo from GitHub and only runs Claude; a start it can't serve falls back to this machine. A ticket can pick the other from its Start menu."
          >
            <select
              aria-label="Run ticket agents on"
              value={host}
              onChange={(e) => chooseHost(e.target.value as RunsOn)}
            >
              <option value="local">This machine</option>
              <option value="vercel">Vercel sandbox</option>
            </select>
          </SettingRow>
        )}
        <SettingRow label="Default model" hint="Passed as --model. Blank uses the CLI default.">
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
            placeholder="e.g. --add-dir ../shared"
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
      </SettingSection>
      <KeepAwakeSettings />
    </>
  );
}
