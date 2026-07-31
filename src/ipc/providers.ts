import { invoke } from "@tauri-apps/api/core";

// Model-provider credentials. Keys are stored 0600 on the Rust side
// and never cross to the renderer — the UI only learns whether one is saved.

export function moonshotKeyConfigured(): Promise<boolean> {
  return invoke("moonshot_key_configured");
}

/** Save (or, with an empty string, clear) the Moonshot API key. */
export function setMoonshotKey(key: string): Promise<void> {
  return invoke("set_moonshot_key", { key });
}

export function fireworksKeyConfigured(): Promise<boolean> {
  return invoke("fireworks_key_configured");
}

/** Save (or, with an empty string, clear) the Fireworks API key. */
export function setFireworksKey(key: string): Promise<void> {
  return invoke("set_fireworks_key", { key });
}
