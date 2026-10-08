import { create } from "zustand";
import { DEFAULT_SPRITE } from "./characters";

// Buddy UI state. `enabled` and `character` persist (loaded once, written by
// their setters — no effect pairs); the rest is per-session.

const ENABLED_KEY = "trace.buddy.enabled";
const CHARACTER_KEY = "trace.buddy.character";

export interface Bubble {
  id: number;
  text: string;
  /** Clicking the bubble opens this issue. */
  issueKey?: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort persistence
  }
}

let bubbleSeq = 0;

interface BuddyStore {
  enabled: boolean;
  character: string;
  /** Epoch ms; speech is suppressed until then. */
  mutedUntil: number;
  bubble: Bubble | null;
  petting: boolean;
  lastInteractionAt: number;
  setEnabled: (on: boolean) => void;
  setCharacter: (id: string) => void;
  say: (text: string, issueKey?: string) => void;
  dismiss: () => void;
  setPetting: (on: boolean) => void;
  /** Mute for `ms`, or unmute when already muted. */
  toggleMute: (ms: number) => void;
  touch: () => void;
}

export const useBuddyStore = create<BuddyStore>((set, get) => ({
  enabled: read(ENABLED_KEY) !== "false",
  character: read(CHARACTER_KEY) ?? DEFAULT_SPRITE,
  mutedUntil: 0,
  bubble: null,
  petting: false,
  lastInteractionAt: Date.now(),
  setEnabled(on) {
    write(ENABLED_KEY, String(on));
    set({ enabled: on, bubble: null });
  },
  setCharacter(id) {
    write(CHARACTER_KEY, id);
    set({ character: id });
  },
  say(text, issueKey) {
    set({ bubble: { id: ++bubbleSeq, text, issueKey } });
  },
  dismiss() {
    set({ bubble: null });
  },
  setPetting(on) {
    set(on ? { petting: true, lastInteractionAt: Date.now() } : { petting: false });
  },
  toggleMute(ms) {
    const muted = get().mutedUntil > Date.now();
    set({ mutedUntil: muted ? 0 : Date.now() + ms, bubble: null });
  },
  touch() {
    set({ lastInteractionAt: Date.now() });
  },
}));
