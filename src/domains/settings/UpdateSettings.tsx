import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import { appVersion, checkAppUpdate, installAppUpdate, type UpdateInfo } from "@/ipc/update";
import { Changelog } from "./Changelog";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";

type Phase = "idle" | "checking" | "current" | "available" | "installing";

// Settings → About: the running version, and updates — check the GitHub release
// feed on demand, then install + relaunch in place; below, every release's notes
// (`Changelog`), with the ones an update would bring marked New. The primary keeps its place
// through every phase (Check → Checking… → Install & restart → Installing…). Dev
// builds have no release feed behind them, so a failed check is a toast, not fatal.
export function UpdateSettings() {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const check = async () => {
    setPhase("checking");
    try {
      const found = await checkAppUpdate();
      setUpdate(found);
      setPhase(found ? "available" : "current");
    } catch (err) {
      toast.error(`Couldn't check for updates: ${String(err)}`);
      setPhase("idle");
    }
  };

  const install = async () => {
    setPhase("installing");
    try {
      await installAppUpdate();
      // The app restarts on success — anything after this only runs on failure.
    } catch (err) {
      toast.error(`Couldn't install the update: ${String(err)}`);
      setPhase("available");
    }
  };

  const installing = phase === "installing";
  const hint =
    phase === "current"
      ? "You're on the latest version."
      : phase === "available"
        ? "What's new since your version is marked New in the changelog below."
        : installing
          ? "Downloading and installing. trace restarts when it's done."
          : "Updates are downloaded from GitHub releases and verified before installing.";

  return (
    <>
      <SettingSection title="trace">
        <SettingRow label="Version">
          <span className="about-version">{version ? `v${version}` : "—"}</span>
        </SettingRow>
        <SettingRow label={update ? `v${update.version} available` : "Updates"} hint={hint}>
          {update && (phase === "available" || installing) ? (
            <button
              type="button"
              className="btn primary"
              disabled={installing}
              onClick={() => void install()}
            >
              <I.Download size={14} />
              <BusyLabel busy={installing} idle="Install & restart" working="Installing…" />
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => void check()}
              disabled={phase === "checking"}
            >
              <BusyLabel busy={phase === "checking"} idle="Check for updates" working="Checking…" />
            </button>
          )}
        </SettingRow>
      </SettingSection>
      <Changelog current={version} update={update} />
    </>
  );
}
