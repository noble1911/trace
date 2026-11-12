import { useEffect, useState } from "react";
import { Switch } from "@/components/Switch";
import { getKeepAwake, setKeepAwake } from "@/ipc/keepAwake";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";

// Settings → Agents → While agents run. The switch is saved backend-side, where the
// hold on the computer starts and ends; this only reads and flips it.
export function KeepAwakeSettings() {
  // On by default, so it reads as on until the saved answer arrives.
  const [on, setOn] = useState(true);

  useEffect(() => {
    getKeepAwake()
      .then(setOn)
      .catch(() => {});
  }, []);

  const choose = (next: boolean) => {
    setOn(next);
    setKeepAwake(next).catch(() => setOn(!next));
  };

  return (
    <SettingSection
      title="While agents run"
      desc="How trace treats this computer while work is going."
    >
      <SettingRow
        label="Keep this computer awake while agents run"
        hint="The display can still sleep. Sleep resumes once no agent is running."
      >
        <Switch on={on} onChange={choose} label="Keep this computer awake while agents run" />
      </SettingRow>
    </SettingSection>
  );
}
