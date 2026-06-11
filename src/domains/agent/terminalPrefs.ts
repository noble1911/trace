// Terminal presentation preferences (font, size, line height) configured in
// Settings, read from localStorage so the Settings UI and the live terminals
// in `terminalRegistry` share one source of truth.

const FONT_KEY = "trace.termFontFamily";
const SIZE_KEY = "trace.termFontSize";
const LINE_HEIGHT_KEY = "trace.termLineHeight";

// xterm paints to a canvas and can't resolve CSS variables, so this mirrors
// tokens.css --font-mono. A user-chosen font is *prepended* to this stack so
// missing glyphs (box drawing, powerline) still fall back to something sane.
export const DEFAULT_TERM_FONT_STACK =
  '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
export const DEFAULT_TERM_FONT_SIZE = 12;
export const DEFAULT_TERM_LINE_HEIGHT = 1;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in sandboxed contexts — keep the
    // in-memory value and silently skip persistence.
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** The font setting as typed, for the Settings input ("" = default). */
export function termFontRaw(): string {
  return read(FONT_KEY);
}

/** The effective xterm font stack: the chosen font in front of the defaults. */
export function termFontFamily(): string {
  const raw = termFontRaw().trim();
  if (!raw) return DEFAULT_TERM_FONT_STACK;
  // A value with a comma is already a stack — trust it as written.
  if (raw.includes(",")) return raw;
  return `"${raw.replace(/"/g, "")}", ${DEFAULT_TERM_FONT_STACK}`;
}

export function setTermFont(next: string) {
  write(FONT_KEY, next.trim());
}

/** The size setting as typed, for the Settings input ("" = default). */
export function termFontSizeRaw(): string {
  return read(SIZE_KEY);
}

export function termFontSize(): number {
  const n = Number.parseFloat(termFontSizeRaw());
  return Number.isFinite(n) ? clamp(Math.round(n), 8, 32) : DEFAULT_TERM_FONT_SIZE;
}

export function setTermFontSize(next: string) {
  write(SIZE_KEY, next.trim());
}

/** The line-height setting as typed, for the Settings input ("" = default). */
export function termLineHeightRaw(): string {
  return read(LINE_HEIGHT_KEY);
}

export function termLineHeight(): number {
  const n = Number.parseFloat(termLineHeightRaw());
  return Number.isFinite(n) ? clamp(n, 1, 2) : DEFAULT_TERM_LINE_HEIGHT;
}

export function setTermLineHeight(next: string) {
  write(LINE_HEIGHT_KEY, next.trim());
}
