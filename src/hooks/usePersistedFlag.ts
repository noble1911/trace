import { create } from "zustand";

// On/off UI preferences that survive a relaunch (sidebars open or closed). The
// one place a flag touches localStorage — and shared through a store, so two
// components reading the same flag (the app shell's layout and the sidebar
// itself) always agree.

interface FlagState {
  values: Record<string, boolean>;
  set: (key: string, value: boolean) => void;
}

const useFlags = create<FlagState>((set) => ({
  values: {},
  set: (key, value) => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // Persistence is best-effort; the in-memory value still applies.
    }
    set((s) => ({ values: { ...s.values, [key]: value } }));
  },
}));

function stored(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v !== "0";
  } catch {
    return fallback;
  }
}

/** A persisted boolean: `[value, toggle]`. */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, () => void] {
  const value = useFlags((s) => s.values[key]) ?? stored(key, fallback);
  const set = useFlags((s) => s.set);
  return [value, () => set(key, !value)];
}
