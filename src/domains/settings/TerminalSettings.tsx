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
      <div className="field">
        <label htmlFor="term-font">Font</label>
        <input
          id="term-font"
          placeholder="e.g. JetBrains Mono — blank uses Geist Mono"
          value={font}
          onChange={(e) => changeFont(e.target.value)}
        />
        <span className="hint">
          Any monospace font installed on your Mac. Glyphs it lacks fall back to the default stack.
        </span>
      </div>
      <div className="field">
        <label htmlFor="term-font-size">Font size</label>
        <input
          id="term-font-size"
          type="number"
          min={8}
          max={32}
          step={1}
          placeholder={String(DEFAULT_TERM_FONT_SIZE)}
          value={size}
          onChange={(e) => changeSize(e.target.value)}
        />
        <span className="hint">Pixels, 8–32. Blank uses {DEFAULT_TERM_FONT_SIZE}.</span>
      </div>
      <div className="field">
        <label htmlFor="term-line-height">Line height</label>
        <input
          id="term-line-height"
          type="number"
          min={1}
          max={2}
          step={0.05}
          placeholder={String(DEFAULT_TERM_LINE_HEIGHT)}
          value={lineHeight}
          onChange={(e) => changeLineHeight(e.target.value)}
        />
        <span className="hint">
          Multiplier between 1 and 2 — a little extra (1.1–1.3) reads less cramped.
        </span>
      </div>
    </section>
  );
}
