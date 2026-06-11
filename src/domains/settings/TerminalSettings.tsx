import { useState } from "react";
import {
  DEFAULT_TERM_FONT_SIZE,
  DEFAULT_TERM_LINE_HEIGHT,
  setTermFont,
  setTermFontSize,
  setTermLineHeight,
  termFontRaw,
  termFontSizeRaw,
  termLineHeightRaw,
} from "@/domains/agent/terminalPrefs";
import { applyTerminalPrefs } from "@/domains/agent/terminalRegistry";
import { SettingRow } from "./SettingRow";

// The Terminal section of Settings. Every change persists and is pushed into
// the live terminals immediately (they survive navigation in the registry, so
// there is no "next terminal" to wait for).
export function TerminalSettings() {
  const [font, setFont] = useState(termFontRaw);
  const [size, setSize] = useState(termFontSizeRaw);
  const [lineHeight, setLineHeight] = useState(termLineHeightRaw);

  const changeFont = (next: string) => {
    setFont(next);
    setTermFont(next);
    applyTerminalPrefs();
  };
  const changeSize = (next: string) => {
    setSize(next);
    setTermFontSize(next);
    applyTerminalPrefs();
  };
  const changeLineHeight = (next: string) => {
    setLineHeight(next);
    setTermLineHeight(next);
    applyTerminalPrefs();
  };

  return (
    <section className="setting-group">
      <h2>Terminal</h2>
      <div className="desc">
        Presentation of the agent chat and shell terminals. Changes apply to open terminals
        immediately.
      </div>
      <SettingRow label="Font" hint="Any installed monospace font; missing glyphs fall back.">
        <input
          type="text"
          aria-label="Terminal font"
          placeholder="Geist Mono"
          value={font}
          onChange={(e) => changeFont(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="Font size" hint={`Pixels, 8–32. Blank uses ${DEFAULT_TERM_FONT_SIZE}.`}>
        <input
          type="number"
          aria-label="Terminal font size"
          min={8}
          max={32}
          step={1}
          placeholder={String(DEFAULT_TERM_FONT_SIZE)}
          value={size}
          onChange={(e) => changeSize(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="Line height" hint="1–2; a little extra (1.1–1.3) reads less cramped.">
        <input
          type="number"
          aria-label="Terminal line height"
          min={1}
          max={2}
          step={0.05}
          placeholder={String(DEFAULT_TERM_LINE_HEIGHT)}
          value={lineHeight}
          onChange={(e) => changeLineHeight(e.target.value)}
        />
      </SettingRow>
    </section>
  );
}
