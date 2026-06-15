import { invoke } from "@tauri-apps/api/core";

// The Anthropic API key for the orchestrator assistant. Stored 0600 on the
// Rust side; the frontend SDK reads it into memory at call time.

export function getAnthropicKey(): Promise<string | null> {
  return invoke("get_anthropic_key");
}

export function setAnthropicKey(key: string): Promise<void> {
  return invoke("set_anthropic_key", { key });
}

/**
 * Run the orchestrator via the Claude CLI in print mode (the `-p` alternative
 * to the SDK). Returns the assistant's full text reply. Read-only — no tools.
 */
export function orchestratorCli(system: string, prompt: string, model?: string): Promise<string> {
  return invoke("orchestrator_cli", { system, prompt, model: model ?? null });
}
