import { invoke } from "@tauri-apps/api/core";

// The Anthropic API key for the orchestrator assistant. Stored 0600 on the
// Rust side; the frontend SDK reads it into memory at call time.

export function getAnthropicKey(): Promise<string | null> {
  return invoke("get_anthropic_key");
}

export function setAnthropicKey(key: string): Promise<void> {
  return invoke("set_anthropic_key", { key });
}
