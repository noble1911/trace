import { create } from "zustand";

/**
 * How much a board card shows: `compact` is key + title + state, `standard`
 * adds the epic, meta and two lines of the agent's last message, `rich` four.
 */
export type Density = "compact" | "standard" | "rich";

const KEY = "trace.boardDensity";

function load(): Density {
  try {
    const v = localStorage.getItem(KEY);
    return v === "compact" || v === "rich" ? v : "standard";
  } catch {
    return "standard";
  }
}

interface DensityStore {
  density: Density;
  setDensity: (density: Density) => void;
}

export const useDensity = create<DensityStore>((set) => ({
  density: load(),
  setDensity(density) {
    try {
      localStorage.setItem(KEY, density);
    } catch {
      // best-effort
    }
    set({ density });
  },
}));
