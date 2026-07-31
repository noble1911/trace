import { useState } from "react";
import { AppLogo } from "@/components/AppLogo";
import { I } from "@/components/Icon";
import { useIssuesStore } from "../store";
import type { ProviderKind } from "../types";

// Mandatory login gate. The board cannot render without an issue tracker.
export function ProviderLogin() {
  const [tab, setTab] = useState<ProviderKind>("jira");

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div className="modal" style={{ width: "min(440px, calc(100vw - 32px))" }}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <AppLogo size={28} />
            <h2 style={{ margin: 0 }}>Connect your tracker</h2>
          </div>
          <div className="desc">
            trace builds your board from your issue tracker — columns from its statuses, cards from
            its current work.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className={`btn ${tab === "jira" ? "primary" : ""}`}
              onClick={() => setTab("jira")}
            >
              Jira
            </button>
            <button
              type="button"
              className={`btn ${tab === "pylon" ? "primary" : ""}`}
              onClick={() => setTab("pylon")}
            >
              Pylon
            </button>
          </div>
        </div>
        {tab === "jira" ? <JiraForm /> : <PylonForm />}
      </div>
    </div>
  );
}

export function JiraForm() {
  const connect = useIssuesStore((s) => s.connectJira);
  const connecting = useIssuesStore((s) => s.connecting);
  const error = useIssuesStore((s) => s.error);

  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = site.trim() && email.trim() && token.trim() && !connecting;
  const submit = () => {
    if (canSubmit) void connect(site.trim(), email.trim(), token.trim());
  };

  return (
    <>
      <div className="modal-body">
        <div className="field">
          <label htmlFor="jira-site">Site</label>
          <input
            id="jira-site"
            placeholder="your-org.atlassian.net"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="jira-email">Email</label>
          <input
            id="jira-email"
            placeholder="you@your-org.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="jira-token">API token</label>
          <input
            id="jira-token"
            type="password"
            placeholder="Paste your Atlassian API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="hint">
            Create one at id.atlassian.com → Security → API tokens. Stored in a private file only
            your user account can read; it never leaves this Mac.
          </span>
        </div>
        {error && <div style={{ color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn primary" disabled={!canSubmit} onClick={submit}>
          <I.Bolt size={13} /> {connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
    </>
  );
}

export function PylonForm() {
  const connect = useIssuesStore((s) => s.connectPylon);
  const connecting = useIssuesStore((s) => s.connecting);
  const error = useIssuesStore((s) => s.error);

  const [token, setToken] = useState("");

  const canSubmit = token.trim() && !connecting;
  const submit = () => {
    if (canSubmit) void connect(token.trim());
  };

  return (
    <>
      <div className="modal-body">
        <div className="field">
          <label htmlFor="pylon-token">API token</label>
          <input
            id="pylon-token"
            type="password"
            placeholder="Paste your Pylon API token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="hint">
            Create one in Pylon → Settings → API tokens (Admin only). Stored in a private file only
            your user account can read; it never leaves this Mac.
          </span>
        </div>
        {error && <div style={{ color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn primary" disabled={!canSubmit} onClick={submit}>
          <I.Bolt size={13} /> {connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
    </>
  );
}
