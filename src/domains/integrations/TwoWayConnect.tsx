import { type ReactNode, useState } from "react";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import type { TrackerSite } from "@/ipc/issues";
import type { LoginWay } from "./registry";

interface TwoWayConnectProps {
  way: LoginWay;
  /** Connect with the login. Resolves to the sites to pick from when it reaches several (it's
   * called again with the chosen id), else null; rejects with the reason it failed. */
  onLogin: (siteId?: string) => Promise<TrackerSite[] | null>;
  /** The API token form. */
  children: ReactNode;
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

// A tracker's two ways to connect: its own login (over its MCP server, the primary), then an
// API token. Jira's today; Pylon's next, with its own `LoginWay` and store action.
export function TwoWayConnect({ way, onLogin, children }: TwoWayConnectProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<TrackerSite[] | null>(null);
  const [siteId, setSiteId] = useState("");

  const login = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onLogin(sites ? siteId : undefined)
      .then((choice) => {
        if (!choice) return;
        setSites(choice);
        setSiteId(choice[0]?.id ?? "");
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ig-ways">
      <div className="ig-way">
        <h3>{way.heading}</h3>
        <span className="ig-note">{way.note}</span>
        {sites && (
          <div className="field">
            <label htmlFor="login-site">Site</label>
            <select id="login-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name === s.url ? hostOf(s.url) : `${s.name} · ${hostOf(s.url)}`}
                </option>
              ))}
            </select>
            <span className="hint">
              Your login reaches more than one site: pick the one whose boards to show.
            </span>
          </div>
        )}
        {error && <div className="ig-error">{error}</div>}
        <button
          type="button"
          className="btn primary"
          disabled={busy || (sites !== null && !siteId)}
          onClick={login}
        >
          <I.Plug size={14} />{" "}
          <BusyLabel
            busy={busy}
            idle={sites ? "Connect" : way.label}
            working={sites ? "Connecting…" : "Waiting for your browser…"}
          />
        </button>
      </div>
      <div className="ig-way">
        <h3>API token</h3>
        {children}
      </div>
    </div>
  );
}
