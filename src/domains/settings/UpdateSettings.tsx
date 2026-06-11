import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { appVersion, checkAppUpdate, installAppUpdate, type UpdateInfo } from "@/ipc/update";

type Phase = "idle" | "checking" | "current" | "available" | "installing";

// The Updates section of Settings: show the running version, check the GitHub
// release feed on demand, and install + relaunch in place. Dev builds have no
// release feed behind them, so a failed check is shown, not fatal.
export function UpdateSettings() {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);

  const check = async () => {
    setPhase("checking");
    setError(null);
    try {
      const found = await checkAppUpdate();
      setUpdate(found);
      setPhase(found ? "available" : "current");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  };

  const install = async () => {
    setPhase("installing");
    setError(null);
    try {
      await installAppUpdate();
      // The app restarts on success — anything after this only runs on failure.
    } catch (err) {
      setError(String(err));
      setPhase("available");
    }
  };

  return (
    <section className="setting-group">
      <h2>Updates</h2>
      <div className="desc">
        trace {version ? `v${version}` : ""} — updates are downloaded from GitHub releases and
        verified before installing.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        {phase === "available" && update ? (
          <button type="button" className="btn primary" onClick={() => void install()}>
            <I.Bolt size={13} /> Install v{update.version} &amp; restart
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => void check()}
            disabled={phase === "checking" || phase === "installing"}
          >
            {phase === "checking" ? "Checking…" : "Check for updates"}
          </button>
        )}
        {phase === "installing" && <span className="hint">Downloading and installing…</span>}
        {phase === "current" && <span className="hint">You're on the latest version.</span>}
        {error && <span style={{ fontSize: 12.5, color: "var(--c-danger)" }}>{error}</span>}
      </div>
      {phase === "available" && update?.notes && (
        <span className="hint" style={{ marginTop: 8, display: "block" }}>
          {update.notes}
        </span>
      )}
    </section>
  );
}
