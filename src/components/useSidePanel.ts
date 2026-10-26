import { useEffect } from "react";
import { create } from "zustand";

// The right-edge side panel's state: per place, whether it's open and which
// view it shows (one view at a time — "Pull requests" or "Orchestrator"). Each
// place remembers its own; the choice survives a relaunch.

/** Where a side panel can live. A detail overlay's sits above its page's. */
export type PanelPlace = "board" | "sessions" | "ticket" | "session";

interface PlaceState {
  open: boolean;
  view: string;
}

/** Details and PRs start open on a ticket or session; a page's assistant starts folded. */
const DEFAULTS: Record<PanelPlace, PlaceState> = {
  board: { open: false, view: "orchestrator" },
  sessions: { open: false, view: "orchestrator" },
  ticket: { open: true, view: "context" },
  session: { open: true, view: "context" },
};

const KEY = "trace.sidePanels";

function load(): Partial<Record<PanelPlace, PlaceState>> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof v === "object" && v !== null
      ? (v as Partial<Record<PanelPlace, PlaceState>>)
      : {};
  } catch {
    return {};
  }
}

interface SidePanelStore {
  places: Partial<Record<PanelPlace, PlaceState>>;
  /** Mounted places, innermost last — a detail over the board sits above it. */
  stack: PanelPlace[];
  set: (place: PanelPlace, patch: Partial<PlaceState>) => void;
  mount: (place: PanelPlace) => void;
  unmount: (place: PanelPlace) => void;
}

const useStore = create<SidePanelStore>((set) => ({
  places: load(),
  stack: [],
  set(place, patch) {
    set((s) => {
      const places = { ...s.places, [place]: { ...DEFAULTS[place], ...s.places[place], ...patch } };
      try {
        localStorage.setItem(KEY, JSON.stringify(places));
      } catch {
        // best-effort: the choice still applies this run
      }
      return { places };
    });
  },
  mount(place) {
    set((s) => ({ stack: [...s.stack.filter((p) => p !== place), place] }));
  },
  unmount(place) {
    set((s) => ({ stack: s.stack.filter((p) => p !== place) }));
  },
}));

/**
 * One place's side panel. `views` are the ids it can show right now (a session
 * has no "context" view until it has a PR); a remembered view that isn't among
 * them shows the strip, with the first view ready to open.
 */
export function useSidePanel(place: PanelPlace, views: string[]) {
  const state = useStore((s) => s.places[place]) ?? DEFAULTS[place];
  const set = useStore((s) => s.set);
  const mount = useStore((s) => s.mount);
  const unmount = useStore((s) => s.unmount);
  useEffect(() => {
    mount(place);
    return () => unmount(place);
  }, [place, mount, unmount]);
  // A remembered view this place can't show right now (no PRs yet) doesn't
  // open another in its stead — the panel stays folded until asked.
  const available = views.includes(state.view);
  return {
    open: state.open && available,
    view: available ? state.view : (views[0] ?? state.view),
    show: (id: string) => set(place, { open: true, view: id }),
    close: () => set(place, { open: false }),
  };
}

/**
 * Show `view` in the side panel in front (the innermost mounted place), or fold
 * it if that view is already showing — ⌘J for the orchestrator. Returns false
 * when no place with a side panel is on screen.
 */
export function toggleFrontView(view: string): boolean {
  const { stack, places, set } = useStore.getState();
  const place = stack[stack.length - 1];
  if (!place) return false;
  const state = places[place] ?? DEFAULTS[place];
  if (state.open && state.view === view) set(place, { open: false });
  else set(place, { open: true, view });
  return true;
}

/** Open `view` on `place` — for jumping there when nothing on screen has a panel. */
export function showView(place: PanelPlace, view: string): void {
  useStore.getState().set(place, { open: true, view });
}
