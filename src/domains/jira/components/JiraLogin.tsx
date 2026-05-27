import { useState } from "react";
import { I } from "@/components/Icon";
import { useJiraStore } from "../store";

// Mandatory login gate. The board cannot render without a Jira connection.
export function JiraLogin() {
  const connect = useJiraStore((s) => s.connect);
  const connecting = useJiraStore((s) => s.connecting);
  const error = useJiraStore((s) => s.error);

  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = site.trim() && email.trim() && token.trim() && !connecting;
  const submit = () => {
    if (canSubmit) void connect(site.trim(), email.trim(), token.trim());
  };

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div className="modal" style={{ width: "min(440px, calc(100vw - 32px))" }}>
        <div className="modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span className="logo" style={{ width: 28, height: 28, marginBottom: 0, fontSize: 12 }}>
              tr
            </span>
            <h2 style={{ margin: 0 }}>Connect to Jira</h2>
          </div>
          <div className="desc">
            trace builds your board from Jira — columns from your board's statuses, cards from your
            current sprint. Sign in with an Atlassian API token.
          </div>
        </div>
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
              Create one at id.atlassian.com → Security → API tokens. Stored in your OS keychain.
            </span>
          </div>
          {error && <div style={{ color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" disabled={!canSubmit} onClick={submit}>
            <I.Bolt size={13} /> {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
