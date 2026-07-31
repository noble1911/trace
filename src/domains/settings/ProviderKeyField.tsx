import { useEffect, useState } from "react";
import type { AgentProvider } from "@/ipc/agent";
import {
  fireworksKeyConfigured,
  moonshotKeyConfigured,
  setFireworksKey,
  setMoonshotKey,
} from "@/ipc/providers";

// The masked API-key field for a third-party model provider. The key is stored
// 0600 Rust-side and never read back — the UI only learns whether one exists.

interface ProviderKeyFieldProps {
  provider: Exclude<AgentProvider, "anthropic">;
}

const META: Record<ProviderKeyFieldProps["provider"], { label: string; origin: string }> = {
  moonshot: { label: "Moonshot API key", origin: "platform.moonshot.ai" },
  fireworks: { label: "Fireworks API key", origin: "fireworks.ai" },
};

export function ProviderKeyField({ provider }: ProviderKeyFieldProps) {
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState("");
  const meta = META[provider];

  const configured = provider === "moonshot" ? moonshotKeyConfigured : fireworksKeyConfigured;
  const persist = provider === "moonshot" ? setMoonshotKey : setFireworksKey;

  useEffect(() => {
    configured()
      .then(setSaved)
      .catch(() => setSaved(false));
  }, [configured]);

  const save = async (next: string) => {
    await persist(next);
    setSaved(Boolean(next.trim()));
    setDraft("");
  };

  return (
    <div className="setting-block">
      <div className="label">{meta.label}</div>
      <div className="hint">
        {saved
          ? "A key is saved. Enter a new one to replace it."
          : `Required for Kimi agents via this provider — from ${meta.origin}.`}
      </div>
      <div className="key-row">
        <input
          type="password"
          className="key-input"
          aria-label={meta.label}
          placeholder={saved ? "•••••••••••••••• (saved)" : "…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="key-btn"
          disabled={!draft.trim()}
          onClick={() => void save(draft)}
        >
          Save
        </button>
      </div>
      {saved && (
        <button type="button" className="key-remove" onClick={() => void save("")}>
          Remove key
        </button>
      )}
    </div>
  );
}
