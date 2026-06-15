import { useEffect, useState } from "react";
import { getAnthropicKey, setAnthropicKey } from "@/ipc/orchestrator";

// The Anthropic API key for the Orchestrator (⌘J). Stored 0600 on the Rust
// side; we only load whether one is set — the value is never echoed back into
// the field, so a saved key shows as a masked placeholder.
export function AssistantSettings() {
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
        The Orchestrator (⌘J) calls Claude with your own Anthropic API key. It's written 0600 on
        disk and used only for the assistant's requests.
      </div>
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
    </section>
  );
}
