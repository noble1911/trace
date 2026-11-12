import { useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/Switch";
import {
  type McpServerStatus,
  mcpConnect,
  mcpDisconnect,
  mcpMove,
  mcpSetUse,
  NEEDS_CLIENT_ID,
  REDIRECT_URI,
} from "@/ipc/mcp";
import { McpLogo } from "./McpLogo";

interface Props {
  server: McpServerStatus;
  onClose: () => void;
  /** The list after an action. */
  onChange: (list: McpServerStatus[]) => void;
}

// One MCP server: connect it (OAuth in the browser, a pasted key, or nothing for an open
// one), then say which agents get it — on this computer (through trace, which adds the
// login to each call) and in sandboxes (whose network adds it) — or disconnect it.
export function McpServerDialog({ server, onClose, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [needsClient, setNeedsClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [key, setKey] = useState("");

  const act = (work: Promise<McpServerStatus[]>, done?: string) => {
    setBusy(true);
    work
      .then((list) => {
        onChange(list);
        if (done) toast.success(done);
      })
      .catch((e) => {
        if (String(e).includes(NEEDS_CLIENT_ID)) setNeedsClient(true);
        else toast.error(String(e));
      })
      .finally(() => setBusy(false));
  };
  const connect = () =>
    act(
      mcpConnect(server, { clientId: clientId.trim() || undefined, key: key.trim() || undefined }),
      `Connected ${server.name}.`
    );
  const setUse = (local: boolean, remote: boolean) => act(mcpSetUse(server.url, local, remote));

  return (
    <Modal title={server.name} onClose={onClose}>
      <div className="ig-dialog">
        <div className="ig-dialog-head">
          <McpLogo id={server.logo} name={server.name} />
          <div className="ig-dialog-text">
            <div className="ig-desc">{server.about ?? server.url}</div>
            <div className="ig-account" title={server.url}>
              {server.host} · tools as mcp__{server.name}__…
            </div>
          </div>
        </div>
        {server.connected ? (
          <>
            <section className="ig-sub">
              <h3>Agents that get it</h3>
              <UseRow
                label="On this computer"
                hint={
                  server.source === "config"
                    ? "Your Claude config already gives them this server; switch on to use trace's login instead."
                    : "Through trace, which adds the login to each call."
                }
                on={server.local}
                onChange={(on) => setUse(on, server.remote)}
                disabled={busy}
              />
              <UseRow
                label="In Vercel sandboxes"
                hint="The sandbox's network adds the login; it never enters the sandbox."
                on={server.remote}
                onChange={(on) => setUse(server.local, on)}
                disabled={busy}
              />
              {expiryNote(server) && <div className="ig-note">{expiryNote(server)}</div>}
            </section>
            {server.replacedBy && (
              <MoveNotice
                server={server}
                to={server.replacedBy}
                busy={busy}
                onMove={(to) => act(mcpMove(server, to), `Moved ${server.name}.`)}
              />
            )}
            <div className="ig-form-foot">
              <InlineConfirm
                label="Disconnect"
                message={`Remove ${server.name} and trace's login to it?`}
                confirmLabel="Disconnect"
                onConfirm={() => act(mcpDisconnect(server.url))}
              />
            </div>
          </>
        ) : (
          <>
            <div className="ig-note">{howItConnects(server)}</div>
            {server.auth === "key" && (
              <div className="field">
                <label htmlFor="mcp-key">Key</label>
                <input
                  id="mcp-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                {server.keyHint && <span className="hint">{server.keyHint}</span>}
              </div>
            )}
            {needsClient && (
              <div className="field">
                <label htmlFor="mcp-client-id">Client ID</label>
                <input
                  id="mcp-client-id"
                  autoComplete="off"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
                <span className="hint">
                  {server.host} can't register trace itself. Register trace with it once, as a
                  public client (no secret) with redirect <code>{REDIRECT_URI}</code>, and paste its
                  client ID.
                </span>
              </div>
            )}
            <div className="ig-form-foot">
              <button
                type="button"
                className="btn primary"
                disabled={busy || (server.auth === "key" && !key.trim())}
                onClick={connect}
              >
                <BusyLabel
                  busy={busy}
                  idle={server.auth === "open" ? "Add" : "Connect"}
                  working={server.auth === "oauth" ? "Waiting for your browser…" : "Adding…"}
                />
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// A server whose service retired its URL: it keeps working until it's moved, which
// means logging in again at the new one (new scopes). The move replaces it in place.
function MoveNotice(props: {
  server: McpServerStatus;
  to: string;
  busy: boolean;
  onMove: (to: string) => void;
}) {
  const newHost = props.to.replace(/^https:\/\//, "");
  return (
    <section className="ig-sub">
      <h3>A newer server</h3>
      <div className="ig-note">
        {props.server.host} is retiring this server for <code>{newHost}</code>. Move to it to keep{" "}
        {props.server.name} working: you log in once more, and agents get it as before.
      </div>
      <div className="ig-form-foot">
        <button
          type="button"
          className="btn primary"
          disabled={props.busy}
          onClick={() => props.onMove(props.to)}
        >
          <BusyLabel
            busy={props.busy}
            idle="Move to new server"
            working="Waiting for your browser…"
          />
        </button>
      </div>
    </section>
  );
}

function UseRow(props: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="mcp-use">
      <div className="mcp-use-text">
        <span className="mcp-use-label">{props.label}</span>
        <span className="mcp-use-hint">{props.hint}</span>
      </div>
      <Switch
        on={props.on}
        onChange={props.onChange}
        label={props.label}
        disabled={props.disabled}
      />
    </div>
  );
}

function howItConnects(s: McpServerStatus): string {
  if (s.auth === "open") return "No login needed: anyone can call it.";
  if (s.auth === "key") return "Paste its key once. trace keeps it; agents never see it.";
  return `Opens ${s.host}'s login in your browser. trace keeps the login; agents never see it.`;
}

function expiryNote(s: McpServerStatus): string | null {
  if (s.auth !== "oauth" || s.refreshable || s.expiresAt === null) return null;
  const at = new Date(s.expiresAt).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${s.host} doesn't let trace renew this login: it lasts until ${at}, then connect it again.`;
}
