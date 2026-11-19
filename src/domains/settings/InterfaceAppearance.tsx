import { FontField } from "@/components/FontField";
import { Segmented } from "@/components/Segmented";
import { Switch } from "@/components/Switch";
import { type Density, UI_SCALES } from "@/domains/appearance/prefs";
import { InterfacePreview } from "@/domains/appearance/previews/InterfacePreview";
import { useAppearance } from "@/domains/appearance/store";
import { useFontChoices } from "@/domains/appearance/useFontChoices";
import { AppearanceGroup } from "./AppearanceGroup";
import { SettingRow } from "./SettingRow";

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "comfortable", label: "Comfortable" },
];
const SCALES = UI_SCALES.map((s) => ({ value: s, label: `${s}%` }));

/** What this group's reset puts back. */
const KEYS = ["uiScale", "density", "uiFont", "monoFont", "motion"] as const;

// Appearance → Interface: how large and dense the app is, its fonts, and motion.
// Interface size is the page's first control on purpose: it zooms this page too,
// and nothing above it can move (AppearanceSettings keeps it under the pointer).
export function InterfaceAppearance() {
  const prefs = useAppearance((s) => s.prefs);
  const systemReducedMotion = useAppearance((s) => s.systemReducedMotion);
  const update = useAppearance((s) => s.update);
  const reset = useAppearance((s) => s.reset);
  const fonts = useFontChoices();

  return (
    <AppearanceGroup
      title="Interface"
      desc="How large and dense the app is, and its fonts."
      preview={<InterfacePreview />}
      onReset={() => reset(KEYS)}
    >
      <SettingRow label="Interface size" hint="Zooms everything but the terminals.">
        <Segmented
          label="Interface size"
          value={prefs.uiScale}
          options={SCALES}
          onChange={(uiScale) => update({ uiScale })}
        />
      </SettingRow>
      <SettingRow
        label="Density"
        hint="Control heights and text size across the app (this page keeps Standard; the preview shows it). Compact also tightens the chat, and a blank chat text size follows it."
      >
        <Segmented
          label="Density"
          value={prefs.density}
          options={DENSITIES}
          onChange={(density) => update({ density })}
        />
      </SettingRow>
      <SettingRow label="Interface font" hint="Any installed font. Blank uses trace's default.">
        <FontField
          label="Interface font"
          value={prefs.uiFont}
          onChange={(uiFont) => update({ uiFont })}
          suggestions={fonts.ui.suggested}
          installed={fonts.ui.installed}
          defaultFamily="Geist"
        />
      </SettingRow>
      <SettingRow
        label="Code font"
        hint="Ids, keys, branches, diffs and the Files tab. Chat code and the terminal use it unless they have their own."
      >
        <FontField
          label="Code font"
          value={prefs.monoFont}
          onChange={(monoFont) => update({ monoFont })}
          suggestions={fonts.mono.suggested}
          installed={fonts.mono.installed}
          defaultFamily="Geist Mono"
        />
      </SettingRow>
      <SettingRow
        label="Reduce motion"
        hint={
          systemReducedMotion
            ? "Your system asks for reduced motion, so it's on. Change it in the OS settings."
            : "Stops spinners, blinking, slides and the buddy's animation."
        }
      >
        <Switch
          on={prefs.motion === "reduce" || systemReducedMotion}
          onChange={(on) => update({ motion: on ? "reduce" : "system" })}
          label="Reduce motion"
          disabled={systemReducedMotion}
        />
      </SettingRow>
    </AppearanceGroup>
  );
}
