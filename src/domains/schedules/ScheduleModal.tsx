import { useEffect, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { Modal } from "@/components/Modal";
import { Switch } from "@/components/Switch";
import { agentArgsRaw, agentModelRaw, agentProvider } from "@/domains/agent/defaults";
import type { AgentProvider } from "@/ipc/agent";
import { listRepos } from "@/ipc/repos";
import { ScheduleFields } from "./ScheduleFields";
import { useSchedulesStore } from "./store";
import type { Schedule, ScheduledPrompt } from "./types";

interface ScheduleModalProps {
  /** The prompt to edit; omitted to create a new one. */
  prompt?: ScheduledPrompt;
  onClose: () => void;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// Mirrors `schedule::template::render` in Rust.
const VARIABLES = ["date", "time", "weekday", "now", "lastRunAt", "title", "repo"];

/** The form's editable state; flags are one space-separated string while editing. */
interface Draft {
  title: string;
  prompt: string;
  schedule: Schedule;
  repo: string;
  provider: AgentProvider;
  model: string;
  args: string;
  timeoutMins: number;
  notify: boolean;
}

function initialDraft(prompt?: ScheduledPrompt): Draft {
  if (prompt) {
    return {
      title: prompt.title,
      prompt: prompt.prompt,
      schedule: prompt.schedule,
      repo: prompt.repo ?? "",
      provider: prompt.provider ?? "anthropic",
      model: prompt.model ?? "",
      args: prompt.extraArgs.join(" "),
      timeoutMins: prompt.timeoutMins,
      notify: prompt.notify,
    };
  }
  return {
    title: "",
    prompt: "",
    schedule: { kind: "daily", time: "09:00" },
    repo: "",
    provider: agentProvider(),
    model: agentModelRaw(),
    args: agentArgsRaw(),
    timeoutMins: 30,
    notify: true,
  };
}

// Create / edit a scheduled prompt. New prompts start from the agent defaults in
// Settings, copied onto the prompt: the backend runner fires without the
// renderer, so it can't read those defaults at run time.
export function ScheduleModal({ prompt, onClose }: ScheduleModalProps) {
  const save = useSchedulesStore((s) => s.save);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(prompt));
  const [repos, setRepos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listRepos().then((all) => {
      if (cancelled) return;
      setRepos(all);
      setDraft((d) => (d.repo ? d : { ...d, repo: all[0] ?? "" }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Preview against the saved anchor only while the schedule is untouched —
  // saving a changed schedule re-anchors it to now.
  const anchorAt =
    prompt && JSON.stringify(prompt.schedule) === JSON.stringify(draft.schedule)
      ? prompt.anchorAt
      : undefined;

  const submit = () => {
    setSaving(true);
    setError(null);
    save({
      id: prompt?.id ?? null,
      title: draft.title,
      prompt: draft.prompt,
      repo: draft.repo || null,
      provider: draft.provider,
      model: draft.model.trim() || null,
      extraArgs: draft.args.trim() ? draft.args.trim().split(/\s+/) : [],
      schedule: draft.schedule,
      timeoutMins: draft.timeoutMins,
      notify: draft.notify,
    })
      .then((saved) => {
        toast.success(prompt ? `Saved “${saved.title}”` : `Scheduled “${saved.title}”`);
        onClose();
      })
      .catch((err) => setError(String(err)))
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      title={prompt ? "Edit scheduled prompt" : "New scheduled prompt"}
      onClose={onClose}
      className="sched-modal"
      footer={
        <>
          {error && <span className="sched-form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={saving || !repos.length}
          >
            {prompt ? "Save" : "Schedule"}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input
          ref={titleRef}
          className="field-input"
          type="text"
          placeholder="e.g. Morning PR triage"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">Prompt</span>
        <textarea
          className="sched-textarea"
          rows={5}
          placeholder="e.g. Review the PRs merged since {lastRunAt} and summarise anything risky."
          value={draft.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
        />
        <span className="field-note">
          Variables: {VARIABLES.map((v) => `{${v}}`).join(" ")}. Each run is a fresh conversation.
        </span>
      </label>

      <ScheduleFields
        value={draft.schedule}
        onChange={(schedule) => patch({ schedule })}
        anchorAt={anchorAt}
      />

      <div className="sched-form-row">
        {repos.length === 0 ? (
          <div className="field">
            <span className="field-label">Repository</span>
            <span className="field-note">Add a repository in Settings → Repos first.</span>
          </div>
        ) : (
          <label className="field">
            <span className="field-label">Repository</span>
            <select
              className="field-input"
              value={draft.repo}
              onChange={(e) => patch({ repo: e.target.value })}
            >
              {repos.map((r) => (
                <option key={r} value={r}>
                  {basename(r)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Provider</span>
          <select
            className="field-input"
            value={draft.provider}
            onChange={(e) => patch({ provider: e.target.value as AgentProvider })}
          >
            <option value="anthropic">Anthropic</option>
            <option value="moonshot">Kimi (Moonshot)</option>
            <option value="wafer">Kimi (Wafer)</option>
            <option value="wafer-fast">Kimi Fast (Wafer)</option>
            <option value="deepseek">DeepSeek Flash</option>
            <option value="deepseek-pro">DeepSeek Pro</option>
          </select>
        </label>
      </div>
      <div className="sched-form-row">
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="field-input"
            type="text"
            placeholder="CLI default"
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Timeout (minutes, 0 = none)</span>
          <input
            className="field-input"
            type="number"
            min={0}
            max={1440}
            value={draft.timeoutMins}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) patch({ timeoutMins: Math.min(1440, Math.max(0, n)) });
            }}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">CLI flags</span>
        <input
          className="field-input sched-mono"
          type="text"
          spellCheck={false}
          placeholder="--dangerously-skip-permissions"
          value={draft.args}
          onChange={(e) => patch({ args: e.target.value })}
        />
        <span className="field-note">
          Nobody is around to approve permission prompts, so a run that asks for one stalls until
          you answer or it times out. Grant what it needs up front (e.g. <code>--allowedTools</code>{" "}
          or <code>--permission-mode acceptEdits</code>).
        </span>
      </label>
      <div className="sched-form-switch">
        <div>
          <div className="field-label">Notify me</div>
          <div className="field-note">When a run finishes, fails, or needs input.</div>
        </div>
        <Switch
          on={draft.notify}
          onChange={(notify) => patch({ notify })}
          label="Notify on run events"
        />
      </div>
    </Modal>
  );
}
