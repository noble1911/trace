import { useEffect, useState } from "react";
import { listInstalledFonts } from "@/ipc/fonts";
import {
  installedOnly,
  isFixedWidth,
  MONO_FONT_SUGGESTIONS,
  UI_FONT_SUGGESTIONS,
} from "./installedFonts";

// What a font picker offers: a short list of suggestions this machine has, first,
// then every other family installed. The suggestions are measured at once; the
// full list comes from the backend's scan (a moment on first use), so a picker
// opened before it lands shows only the suggestions.

export interface FontChoices {
  /** Curated families this machine has, in their curated order. */
  suggested: string[];
  /** Every other installed family of the kind, sorted. */
  installed: string[];
}

export interface FontChoiceSets {
  /** For interface and chat text fonts. */
  ui: FontChoices;
  /** For code and terminal fonts. */
  mono: FontChoices;
}

interface Split {
  ui: string[];
  mono: string[];
}

// One scan per app session: the backend caches too, but the re-measure below
// (canvas text per family) is worth doing only once.
let split: Promise<Split> | null = null;

/**
 * The installed families as the pickers want them. A font's own monospace flag
 * isn't always set (macOS's Monaco and Courier leave it off), so a "proportional"
 * family that measures fixed-width moves to the monospace list.
 */
function loadSplit(): Promise<Split> {
  split ??= listInstalledFonts().then(({ proportional, monospace }) => {
    const ui: string[] = [];
    const mono = [...monospace];
    for (const family of proportional) (isFixedWidth(family) ? mono : ui).push(family);
    mono.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return { ui, mono };
  });
  return split;
}

function choices(suggested: string[], all: string[]): FontChoices {
  const taken = new Set(suggested.map((f) => f.toLowerCase()));
  return { suggested, installed: all.filter((f) => !taken.has(f.toLowerCase())) };
}

/** The font picker lists for one visit to Appearance. */
export function useFontChoices(): FontChoiceSets {
  const [suggested] = useState(() => ({
    ui: installedOnly(UI_FONT_SUGGESTIONS),
    mono: installedOnly(MONO_FONT_SUGGESTIONS),
  }));
  const [all, setAll] = useState<Split>({ ui: [], mono: [] });
  useEffect(() => {
    let live = true;
    void loadSplit().then((s) => {
      if (live) setAll(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return {
    ui: choices(suggested.ui, all.ui),
    mono: choices(suggested.mono, all.mono),
  };
}

// The scan is cached in this module, so a hot update would keep a stale copy: reload.
import.meta.hot?.accept(() => location.reload());
