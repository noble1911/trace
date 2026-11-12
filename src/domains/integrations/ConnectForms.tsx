import { useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import { useIssuesStore } from "@/domains/issues/store";
import { useVercelStore } from "@/domains/vercel/store";

interface FormFootProps {
  /** Beside another way to connect, whose button is the dialog's primary. */
  secondary?: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  connecting: boolean;
  error: string | null;
}

function FormFoot({ secondary, canSubmit, onSubmit, connecting, error }: FormFootProps) {
  return (
    <>
      {error && <div className="ig-error">{error}</div>}
      <div className="ig-form-foot">
        <button
          type="button"
          className={secondary ? "btn" : "btn primary"}
          disabled={!canSubmit || connecting}
          onClick={onSubmit}
        >
          <I.Plug size={14} /> <BusyLabel busy={connecting} idle="Connect" working="Connecting…" />
        </button>
      </div>
    </>
  );
}

interface TrackerFormProps {
  /** Shown under `TwoWayConnect`, so its Connect isn't the primary. */
  secondary?: boolean;
}

export function JiraForm({ secondary }: TrackerFormProps) {
  const connect = useIssuesStore((s) => s.connectJira);
  const connecting = useIssuesStore((s) => s.connecting);
  const error = useIssuesStore((s) => s.error);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  const canSubmit = Boolean(site.trim() && email.trim() && token.trim());
  const submit = () => {
    if (canSubmit && !connecting) void connect(site.trim(), email.trim(), token.trim());
  };

  return (
    <div className="ig-form">
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
          Create one at id.atlassian.com → Security → API tokens. Stored in a private file only your
          user account can read, and only ever sent to Atlassian.
        </span>
      </div>
      <FormFoot
        secondary={secondary}
        canSubmit={canSubmit}
        onSubmit={submit}
        connecting={connecting}
        error={error}
      />
    </div>
  );
}

export function PylonForm({ secondary }: TrackerFormProps) {
  const connect = useIssuesStore((s) => s.connectPylon);
  const connecting = useIssuesStore((s) => s.connecting);
  const error = useIssuesStore((s) => s.error);
  const [token, setToken] = useState("");

  const canSubmit = Boolean(token.trim());
  const submit = () => {
    if (canSubmit && !connecting) void connect(token.trim());
  };

  return (
    <div className="ig-form">
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
          your user account can read, and only ever sent to Pylon.
        </span>
      </div>
      <FormFoot
        secondary={secondary}
        canSubmit={canSubmit}
        onSubmit={submit}
        connecting={connecting}
        error={error}
      />
    </div>
  );
}

export function VercelForm() {
  const connect = useVercelStore((s) => s.connect);
  const connecting = useVercelStore((s) => s.connecting);
  const error = useVercelStore((s) => s.connectError);
  const [token, setToken] = useState("");

  const canSubmit = Boolean(token.trim());
  const submit = () => {
    if (canSubmit && !connecting) void connect(token.trim());
  };

  return (
    <div className="ig-form">
      <div className="field">
        <label htmlFor="vercel-token">Vercel token</label>
        <input
          id="vercel-token"
          type="password"
          placeholder="Paste your Vercel token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <span className="hint">
          Create one in Vercel → Account Settings → Tokens, limited to one team, with an expiry.
          Stored in a private file only your user account can read, and only ever sent to Vercel.
        </span>
      </div>
      <FormFoot canSubmit={canSubmit} onSubmit={submit} connecting={connecting} error={error} />
    </div>
  );
}
