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

export function waferKeyConfigured(): Promise<boolean> {
  return invoke("wafer_key_configured");
}

/** Save (or, with an empty string, clear) the Wafer Serverless API key. */
export function setWaferKey(key: string): Promise<void> {
  return invoke("set_wafer_key", { key });
}

export function deepseekKeyConfigured(): Promise<boolean> {
  return invoke("deepseek_key_configured");
}

/** Save (or, with an empty string, clear) the DeepSeek API key. */
export function setDeepseekKey(key: string): Promise<void> {
  return invoke("set_deepseek_key", { key });
}
