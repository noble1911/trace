import { Segmented } from "@/components/Segmented";
import type { PeerChoice } from "@/domains/peers/hostChoices";
import type { AgentCli, AgentProvider, Transport } from "@/ipc/agent";
import type { SessionHostId } from "./types";

interface NewSessionMoreProps {
  /** Vercel is connected, so it's a choice. */
  showVercel: boolean;
  /** Paired peers: a choice each, when ready. */
  peers: PeerChoice[];
  hostPick: SessionHostId | "local";
  onHost: (next: SessionHostId | "local") => void;
  cli: AgentCli;
  host: SessionHostId | null;
  /** The peer it runs on, if it does. */
  peerName: string | null;
  provider: AgentProvider;
  onProvider: (next: AgentProvider) => void;
  shownAs: Transport;
  onTransport: (next: Transport) => void;
  canChat: boolean;
  needsLogin: boolean;
}

/** "Run on": this computer, a Vercel Sandbox, or a ready paired peer. */
function hostOptions(showVercel: boolean, peers: PeerChoice[]) {
  const ready = peers.filter((p) => !p.reason).map((p) => ({ value: p.host, label: p.name }));
  return [
    { value: "local" as const, label: "This computer" },
    ...(showVercel ? [{ value: "vercel" as const, label: "Vercel" }] : []),
    ...ready,
  ];
}

// The New session dialog's second tier: what you rarely change. Where it runs,
// which endpoint is behind Claude, and whether it opens as a chat or a terminal.
export function NewSessionMore({
  showVercel,
  peers,
  hostPick,
  onHost,
  cli,
  host,
  peerName,
  provider,
  onProvider,
  shownAs,
  onTransport,
  canChat,
  needsLogin,
}: NewSessionMoreProps) {
  return (
    <div className="ns-more-fields">
      {(showVercel || peers.some((p) => !p.reason)) && (
        <div className="field">
          <span className="field-label">Run on</span>
          <Segmented
            label="Run on"
            value={hostPick}
            options={hostOptions(showVercel, peers)}
            onChange={onHost}
          />
        </div>
      )}
      {cli === "claude" && (
        <label className="field">
          <span className="field-label">Provider</span>
          <select
            className="field-input"
            value={provider}
            onChange={(e) => onProvider(e.target.value as AgentProvider)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="moonshot">Kimi (Moonshot)</option>
            <option value="wafer">Kimi (Wafer)</option>
            <option value="wafer-fast">Kimi Fast (Wafer)</option>
            <option value="deepseek">DeepSeek Flash</option>
            <option value="deepseek-pro">DeepSeek Pro</option>
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Shows as</span>
        <select
          className="field-input"
          value={shownAs}
          disabled={!canChat || needsLogin}
          onChange={(e) => onTransport(e.target.value as Transport)}
        >
          <option value="chat">Chat</option>
          <option value="terminal">Terminal</option>
        </select>
      </label>
      {needsLogin && (
        <div className="field-note">
          No Claude login is saved for sandboxes, so it runs in a terminal where you can log in with
          /login. To use chat, save one in Integrations → Vercel.
        </div>
      )}
      {peerName && (
        <div className="field-note">
          {peerName} shows a session as a terminal for now, so it runs in one here.
        </div>
      )}
      {!canChat && !host && (
        <div className="field-note">
          {cli === "codex" ? "Codex" : cli} has no chat view yet, so it runs in a terminal.
        </div>
      )}
    </div>
  );
}
