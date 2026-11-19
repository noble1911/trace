import { invoke } from "@tauri-apps/api/core";

// The font families installed on this machine, for Appearance's font pickers.
// The backend scans the OS font folders once and caches it: see `commands::fonts`.

export interface InstalledFonts {
  /** Families whose fonts don't say they're monospace, sorted. */
  proportional: string[];
  /** Families that say they're monospace, sorted. */
  monospace: string[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** Every installed family. Resolves to empty lists if the scan fails (the pickers still type). */
export async function listInstalledFonts(): Promise<InstalledFonts> {
  try {
    const raw: unknown = await invoke("list_installed_fonts");
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return { proportional: strings(o.proportional), monospace: strings(o.monospace) };
  } catch {
    return { proportional: [], monospace: [] };
  }
}
