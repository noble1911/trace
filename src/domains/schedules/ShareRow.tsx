import type { ReactNode } from "react";
import { agentLabel } from "@/domains/agent/providerLabel";
import { describeSchedule } from "./describe";
import type { SharedPrompt } from "./types";

interface ShareRowProps {
  /** A saved prompt (export) or one read from a file (import) — both fit. */
  prompt: Pick<SharedPrompt, "title" | "schedule" | "provider" | "model" | "extraArgs">;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** A short warning after the title, e.g. a name clash. */
  tag?: string | null;
  /** A control on the right, outside the toggle target (the import's repo picker). */
  children?: ReactNode;
}

// One prompt in the export/import checklist; the whole left side toggles it.
// Flags are shown in full: they're what a run may do with nobody watching.
export function ShareRow({ prompt, checked, onToggle, tag, children }: ShareRowProps) {
  const sub = [
    describeSchedule(prompt.schedule),
    agentLabel("claude", prompt.provider),
    prompt.model,
  ].filter(Boolean);

  return (
    <div className={`share-row${checked ? "" : " off"}`}>
      <label className="share-row-main">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span className="share-row-text">
          <span className="share-row-title">
            {prompt.title}
            {tag && <span className="share-row-tag">{tag}</span>}
          </span>
          <span className="share-row-sub">{sub.join(" · ")}</span>
          {prompt.extraArgs.length > 0 && (
            <code className="share-row-flags">{prompt.extraArgs.join(" ")}</code>
          )}
        </span>
      </label>
      {children}
    </div>
  );
}
