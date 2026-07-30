// Persisted size of the orchestrator panel. Long chats need room, so the panel
// is user-resizable; the chosen size outlives the panel (which unmounts when
// closed) in localStorage, wrapped here so nothing else touches the key.

export interface PanelSize {
  width: number;
  height: number;
}

const SIZE_KEY = "trace.orchPanelSize";

/** The design's original panel proportions — also the double-click reset. */
export const DEFAULT_PANEL_SIZE: PanelSize = { width: 400, height: 640 };

// Below this the chat composer and tab bar start to collide.
const MIN_WIDTH = 320;
const MIN_HEIGHT = 260;

// The panel floats over the board; leave enough margin that its own edges (and
// the rail behind it) stay grabbable at any window size.
const VIEWPORT_MARGIN = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Fit a size to the current window — also applied on load and on window resize. */
export function clampPanelSize({ width, height }: PanelSize): PanelSize {
  return {
    width: Math.round(clamp(width, MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN)),
    height: Math.round(clamp(height, MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN)),
  };
}

export function loadPanelSize(): PanelSize {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return DEFAULT_PANEL_SIZE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_SIZE;
    const { width, height } = parsed as Partial<PanelSize>;
    if (typeof width !== "number" || typeof height !== "number") return DEFAULT_PANEL_SIZE;
    return { width, height };
  } catch {
    return DEFAULT_PANEL_SIZE;
  }
}

export function savePanelSize(size: PanelSize): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    // best-effort persistence — the live size still applies
  }
}
