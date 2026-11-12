import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around `commands/keep_awake.rs` — keeping the computer awake while
// agents run. The switch is saved backend-side, where the hold starts and ends.

/** Whether the computer is kept awake while agents run (on by default). */
export function getKeepAwake(): Promise<boolean> {
  return invoke("get_keep_awake");
}

/** Turn it on or off; takes effect at once. */
export function setKeepAwake(enabled: boolean): Promise<void> {
  return invoke("set_keep_awake", { enabled });
}
