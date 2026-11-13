import {
  modeChoices,
  modeLabel,
  modelChoices,
  modelLabel,
  modelName,
} from "@/domains/agentChat/agentOptionsFormat";
import { useClaudeModels } from "@/domains/agentChat/claudeCatalog";
import type { AgentCli } from "@/ipc/agent";
import { basename } from "@/platform/paths";
import type { SessionHostId } from "./types";

interface NewSessionWhereProps {
  host: SessionHostId | null;
  /** The repos on offer: all of them, or only those a sandbox can clone. */
  choices: string[];
  /** True once the sandbox's repo list has arrived, so an empty list means empty. */
  sandboxKnown: boolean;
  /** The peer it runs on, when it does: repos and agents are its own. */
  peerName: string | null;
  /** The agents a peer runs; null when not on one. */
  agentKinds: string[] | null;
  place: string;
  onPlace: (next: string) => void;
  folder: string | null;
  scratchValue: string;
  folderValue: string;
  chooseValue: string;
  cli: AgentCli;
  onCli: (next: AgentCli) => void;
  model: string;
  onModel: (next: string) => void;
  /** Why the model can't be picked here, or null when it can. */
  modelLocked: string | null;
  mode: string;
  onMode: (next: string) => void;
}

// The four choices that change what the agent is and where it works, in one row
// under the task. Everything else is behind More options.
export function NewSessionWhere({
  host,
  choices,
  sandboxKnown,
  peerName,
  agentKinds,
  place,
  onPlace,
  folder,
  scratchValue,
  folderValue,
  chooseValue,
  cli,
  onCli,
  model,
  onModel,
  modelLocked,
  mode,
  onMode,
}: NewSessionWhereProps) {
  const catalog = useClaudeModels();
  return (
    <div className="ns-options">
      <label className="field">
        <span className="field-label">{host ? "Repository" : "Runs in"}</span>
        <select className="field-input" value={place} onChange={(e) => onPlace(e.target.value)}>
          {choices.map((r) => (
            <option key={r} value={r}>
              {basename(r)}
            </option>
          ))}
          {!host && folder && <option value={folderValue}>{basename(folder)}</option>}
          {!host && <option value={scratchValue}>New empty folder</option>}
          {!host && <option value={chooseValue}>Choose a folder…</option>}
          {host && choices.length === 0 && (
            <option value={place}>
              {!sandboxKnown
                ? "Checking…"
                : peerName
                  ? `No repositories on ${peerName}`
                  : "No GitHub repositories"}
            </option>
          )}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Agent</span>
        <select
          className="field-input"
          value={cli}
          disabled={host === "vercel"}
          onChange={(e) => onCli(e.target.value as AgentCli)}
        >
          <option value="claude">Claude</option>
          <option value="codex" disabled={agentKinds !== null && !agentKinds.includes("codex")}>
            Codex
          </option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Model</span>
        <select
          className="field-input"
          value={model}
          disabled={Boolean(modelLocked)}
          title={modelLocked ?? undefined}
          onChange={(e) => onModel(e.target.value)}
        >
          <option value="">{modelLabel(undefined)}</option>
          {modelChoices(cli, model || undefined, catalog).map((m) => (
            <option key={m} value={m}>
              {modelName(m, catalog)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Mode</span>
        <select className="field-input" value={mode} onChange={(e) => onMode(e.target.value)}>
          <option value="">{modeLabel(undefined)}</option>
          {modeChoices(cli).map((m) => (
            <option key={m} value={m}>
              {modeLabel(m)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
