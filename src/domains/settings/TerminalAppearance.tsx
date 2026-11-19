import { useReducer } from "react";
import { FontField } from "@/components/FontField";
import { Segmented } from "@/components/Segmented";
import { Switch } from "@/components/Switch";
import {
  resetTermPrefs,
  setTermFont,
  setTermFontSize,
  setTermLineHeight,
  setTermScrollback,
  termFontFamily,
  termFontRaw,
  termFontSize,
  termFontSizeSetting,
  termLineHeight,
  termScrollback,
} from "@/domains/agent/terminalPrefs";
import { applyTerminalPrefs } from "@/domains/agent/terminalRegistry";
import type { CursorStyle } from "@/domains/appearance/prefs";
import { TerminalPreview } from "@/domains/appearance/previews/TerminalPreview";
import { SizeField } from "@/domains/appearance/SizeField";
import { isMotionReduced, useAppearance } from "@/domains/appearance/store";
import { TermSchemePicker } from "@/domains/appearance/TermSchemePicker";
import {
  DEFAULT_TERM_FONT_SIZE,
  TERM_LINE_HEIGHTS,
  TERM_SCROLLBACKS,
  TERM_SIZE,
} from "@/domains/appearance/terminalOptions";
import { useFontChoices } from "@/domains/appearance/useFontChoices";
import { AppearanceGroup } from "./AppearanceGroup";
import { SettingRow } from "./SettingRow";

const CURSORS: { value: CursorStyle; label: string }[] = [
  { value: "block", label: "Block" },
  { value: "bar", label: "Bar" },
  { value: "underline", label: "Underline" },
];
const LINE_OPTIONS = TERM_LINE_HEIGHTS.map((h) => ({ value: h, label: String(h) }));
const SCROLLBACK_OPTIONS = TERM_SCROLLBACKS.map((n) => ({
  value: n,
  label: n.toLocaleString("en-US"),
}));

/** What this group's reset puts back in the appearance store (the rest is terminalPrefs'). */
const KEYS = ["termScheme", "cursorStyle", "cursorBlink"] as const;

// Appearance → Terminal: colours, font, cursor and scrollback of agent terminals
// and shell terminals. Every change is pushed into the live terminals at once
// (they survive navigation in the registry, so there's no "next terminal" to
// wait for). The font, size, line height and scrollback live in terminalPrefs
// (localStorage, not the store), so a write bumps `version` to re-read them.
export function TerminalAppearance() {
  const prefs = useAppearance((s) => s.prefs);
  const update = useAppearance((s) => s.update);
  const reset = useAppearance((s) => s.reset);
  const reduced = useAppearance(isMotionReduced);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const fonts = useFontChoices();

  const apply = (write: () => void) => {
    write();
    applyTerminalPrefs();
    bump();
  };
  const resetGroup = () =>
    apply(() => {
      resetTermPrefs();
      reset(KEYS);
    });

  return (
    <AppearanceGroup
      title="Terminal"
      desc="Agent terminals and shell terminals. Changes apply to open terminals at once."
      preview={
        <TerminalPreview
          fontFamily={termFontFamily(prefs.monoFont)}
          fontSize={termFontSize()}
          lineHeight={termLineHeight()}
        />
      }
      onReset={resetGroup}
    >
      <div className="ap-sub">
        <div className="label">Colour scheme</div>
        <div className="hint">
          Claude Code chooses its own colours too: run /theme in a session to match a light scheme.
        </div>
      </div>
      <TermSchemePicker />
      <SettingRow label="Font" hint="Any installed monospace font; missing glyphs fall back.">
        <FontField
          label="Terminal font"
          value={termFontRaw()}
          onChange={(font) => apply(() => setTermFont(font))}
          suggestions={fonts.mono.suggested}
          installed={fonts.mono.installed}
          defaultFamily="Same as code font"
        />
      </SettingRow>
      <SettingRow
        label="Font size"
        hint={`Pixels, ${TERM_SIZE.min}–${TERM_SIZE.max}. Blank uses ${DEFAULT_TERM_FONT_SIZE}. Interface size doesn't change it.`}
      >
        <SizeField
          label="Terminal font size"
          value={termFontSizeSetting()}
          range={TERM_SIZE}
          onChange={(px) => apply(() => setTermFontSize(px))}
        />
      </SettingRow>
      <SettingRow
        label="Line height"
        hint="1 joins box drawing up; a little more reads less cramped."
      >
        <Segmented
          label="Terminal line height"
          value={termLineHeight()}
          options={LINE_OPTIONS}
          onChange={(h) => apply(() => setTermLineHeight(h))}
        />
      </SettingRow>
      <SettingRow label="Cursor" hint="Most visible in the shell; Claude Code draws its own.">
        <Segmented
          label="Cursor style"
          value={prefs.cursorStyle}
          options={CURSORS}
          onChange={(cursorStyle) => update({ cursorStyle })}
        />
      </SettingRow>
      <SettingRow
        label="Blinking cursor"
        hint={reduced ? "Paused while motion is reduced." : "Blink the cursor in every terminal."}
      >
        <Switch
          on={prefs.cursorBlink}
          onChange={(cursorBlink) => update({ cursorBlink })}
          label="Blinking cursor"
        />
      </SettingRow>
      <SettingRow
        label="Scrollback"
        hint="Lines each terminal keeps above the screen. Fewer drops the oldest at once."
      >
        <Segmented
          label="Scrollback lines"
          value={termScrollback()}
          options={SCROLLBACK_OPTIONS}
          onChange={(lines) => apply(() => setTermScrollback(lines))}
        />
      </SettingRow>
    </AppearanceGroup>
  );
}
