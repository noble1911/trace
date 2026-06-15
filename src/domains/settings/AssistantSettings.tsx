import { useEffect, useState } from "react";
import {
  type OrchBackend,
  type OrchSpeed,
  useOrchestratorStore,
} from "@/domains/orchestrator/store";
import { getAnthropicKey, setAnthropicKey } from "@/ipc/orchestrator";
import { SettingRow } from "./SettingRow";

// Orchestrator (⌘J) backend: the Anthropic SDK (your API key, full chat +
// actions) or the Claude CLI in print mode (logged-in CLI, read-only). The key
// is stored 0600 on the Rust side and never echoed back — a saved key shows as
// a masked placeholder.
export function AssistantSettings() {
  const backend = useOrchestratorStore((s) => s.backend);
  const setBackend = useOrchestratorStore((s) => s.setBackend);
  const speed = useOrchestratorStore((s) => s.speed);
  const setSpeed = useOrchestratorStore((s) => s.setSpeed);
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    getAnthropicKey()
      .then((k) => setSaved(Boolean(k)))
      .catch(() => setSaved(false));
  }, []);

  // Let the "Saved ✓" confirmation fade on its own rather than lingering.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  const save = async (next: string) => {
    await setAnthropicKey(next);
    setSaved(Boolean(next.trim()));
    setValue("");
    setJustSaved(true);
  };

  return (
    <section className="setting-group">
      <h2>Assistant</h2>
      <div className="desc">
        The Orchestrator (⌘J) talks to Claude either through the Anthropic API (your key) or your
        logged-in Claude CLI.
      </div>
      <SettingRow
        label="Backend"
        hint="SDK uses your API key; CLI (-p) uses the logged-in Claude CLI — both chat and act."
      >
        <select
          aria-label="Assistant backend"
          value={backend}
          onChange={(e) => setBackend(e.target.value as OrchBackend)}
        >
          <option value="sdk">Anthropic API key (SDK)</option>
          <option value="cli">Claude CLI (-p mode)</option>
        </select>
      </SettingRow>
      {backend === "cli" && (
        <div className="hint">
          Uses your logged-in Claude CLI — no API key needed. Chats and takes actions (each behind a
          confirm card); it answers one-shot from the board snapshot rather than the SDK's
          multi-step tool loop.
        </div>
      )}
      <SettingRow
        label="Speed"
        hint="Fast (Sonnet, no extended thinking) is snappy; Thorough (Opus + thinking) reasons harder."
      >
        <select
          aria-label="Assistant speed"
          value={speed}
          onChange={(e) => setSpeed(e.target.value as OrchSpeed)}
        >
          <option value="fast">Fast (Sonnet)</option>
          <option value="thorough">Thorough (Opus)</option>
        </select>
      </SettingRow>
      {backend === "sdk" && (
        <div className="setting-block">
          <div className="label">Anthropic API key</div>
          <div className="hint">
            {saved
              ? "A key is saved. Enter a new one to replace it."
              : "Required to use the Orchestrator chat."}
          </div>
          <div className="key-row">
            <input
              type="password"
              className="key-input"
              aria-label="Anthropic API key"
              placeholder={saved ? "•••••••••••••••• (saved)" : "sk-ant-…"}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setJustSaved(false);
              }}
            />
            <button
              type="button"
              className="key-btn"
              disabled={!value.trim()}
              onClick={() => void save(value)}
            >
              Save
            </button>
          </div>
          {saved && (
            <button type="button" className="key-remove" onClick={() => void save("")}>
              Remove key
            </button>
          )}
          {justSaved && <span className="key-status">Saved ✓</span>}
        </div>
      )}
    </section>
  );
}
