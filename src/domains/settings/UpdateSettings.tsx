import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { appVersion, checkAppUpdate, installAppUpdate, type UpdateInfo } from "@/ipc/update";
import { SettingRow } from "./SettingRow";

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

  const hint =
    phase === "current"
      ? "You're on the latest version."
      : phase === "installing"
        ? "Downloading and installing…"
        : "Updates are downloaded from GitHub releases and verified before installing.";

  return (
    <section className="setting-group">
      <h2>Updates</h2>
      <div className="desc">trace {version ? `v${version}` : ""}</div>
      <SettingRow label={update ? `v${update.version} available` : "App version"} hint={hint}>
        {phase === "available" && update ? (
          <button type="button" className="btn primary" onClick={() => void install()}>
            <I.Bolt size={13} /> Install &amp; restart
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
      </SettingRow>
      {error && <span style={{ fontSize: 12.5, color: "var(--c-danger)" }}>{error}</span>}
      {phase === "available" && update?.notes && (
        <div className="update-notes">
          <div className="update-notes-title">What's new in v{update.version}</div>
          <pre>{update.notes}</pre>
        </div>
      )}
    </section>
  );
}
