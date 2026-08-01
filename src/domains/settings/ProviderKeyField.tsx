import { useEffect, useState } from "react";
import type { AgentProvider } from "@/ipc/agent";
import {
  deepseekKeyConfigured,
  moonshotKeyConfigured,
  setDeepseekKey,
  setMoonshotKey,
  setWaferKey,
  waferKeyConfigured,
} from "@/ipc/providers";

// The masked API-key field for a third-party model provider. The key is stored
// 0600 Rust-side and never read back — the UI only learns whether one exists.
// Normal/fast variants of the same endpoint share one credential.

interface ProviderKeyFieldProps {
  provider: Exclude<AgentProvider, "anthropic">;
}

/** Credential family — Wafer/DeepSeek normal+fast/flash share one key file each. */
type CredFamily = "moonshot" | "wafer" | "deepseek";

function credFamily(provider: ProviderKeyFieldProps["provider"]): CredFamily {
  if (provider === "wafer" || provider === "wafer-fast") return "wafer";
  if (provider === "deepseek" || provider === "deepseek-pro") return "deepseek";
  return "moonshot";
}

const META: Record<CredFamily, { label: string; origin: string }> = {
  moonshot: { label: "Moonshot API key", origin: "platform.moonshot.ai" },
  wafer: { label: "Wafer API key", origin: "app.wafer.ai" },
  deepseek: { label: "DeepSeek API key", origin: "platform.deepseek.com" },
};

const CHECK: Record<CredFamily, () => Promise<boolean>> = {
  moonshot: moonshotKeyConfigured,
  wafer: waferKeyConfigured,
  deepseek: deepseekKeyConfigured,
};

const SAVE: Record<CredFamily, (key: string) => Promise<void>> = {
  moonshot: setMoonshotKey,
  wafer: setWaferKey,
  deepseek: setDeepseekKey,
};

export function ProviderKeyField({ provider }: ProviderKeyFieldProps) {
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState("");
  const family = credFamily(provider);
  const meta = META[family];
  const configured = CHECK[family];
  const persist = SAVE[family];

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
          : `Required for agents via this provider — from ${meta.origin}.`}
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
