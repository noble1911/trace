import { useMemo, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { Switch } from "@/components/Switch";
import { useNow } from "@/hooks/useNow";
import { describeSchedule, formatWhen, relative } from "./describe";
import { RunList } from "./RunList";
import { RunViewer } from "./RunViewer";
import { useSchedulesStore } from "./store";
import type { ScheduledPrompt } from "./types";

interface ScheduleDetailProps {
  prompt: ScheduledPrompt;
  onEdit: () => void;
}

// Full-screen detail for one scheduled prompt (the `.detail` shell sessions and
// issues use): its run history on the left, the selected run's conversation on
// the right — live while it runs, replayed from disk once it's done.
export function ScheduleDetail({ prompt, onEdit }: ScheduleDetailProps) {
  const allRuns = useSchedulesStore((s) => s.runs);
  const openRunId = useSchedulesStore((s) => s.openRunId);
  const selectRun = useSchedulesStore((s) => s.selectRun);
  const close = useSchedulesStore((s) => s.close);
  const setEnabled = useSchedulesStore((s) => s.setEnabled);
  const runNow = useSchedulesStore((s) => s.runNow);
  const stopRun = useSchedulesStore((s) => s.stopRun);
  const remove = useSchedulesStore((s) => s.remove);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = useNow(30_000);

  const runs = useMemo(() => allRuns.filter((r) => r.promptId === prompt.id), [allRuns, prompt.id]);
  // Default to the newest run — which is also where a fresh "Run now" lands.
  const active = runs.find((r) => r.id === openRunId) ?? runs[0];
  const live = runs.find((r) => r.status === "running");
  const fail = (err: unknown) => toast.error(String(err));

  const onDelete = () => {
    // Two clicks: this kills a live run and deletes the history and worktree.
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    void remove(prompt.id)
      .then(() => toast.success(`Deleted “${prompt.title}”`))
      .catch(fail);
  };

  const next =
    prompt.enabled && prompt.nextRunAt
      ? `next ${formatWhen(prompt.nextRunAt)} (${relative(prompt.nextRunAt, now)})`
      : "paused";

  return (
    <div className="detail">
      <div className="detail-top">
        <button type="button" className="back" onClick={close}>
          <I.Back size={14} /> Scheduled
        </button>
        <span className="session-avatar">
          <I.Clock size={18} />
        </span>
        <div>
          <span className="id">
            {describeSchedule(prompt.schedule)} · {next}
          </span>
          <div className="ttl">{prompt.title}</div>
        </div>
        <div className="right">
          <span className="sched-enabled">
            {prompt.enabled ? "Active" : "Paused"}
            <Switch
              on={prompt.enabled}
              onChange={(enabled) => void setEnabled(prompt.id, enabled).catch(fail)}
              label={prompt.enabled ? "Pause schedule" : "Resume schedule"}
            />
          </span>
          <button type="button" className="btn" onClick={onEdit}>
            <I.Pencil size={13} /> Edit
          </button>
          <button
            type="button"
            className={`btn${confirmDelete ? " danger" : ""}`}
            onClick={onDelete}
            onBlur={() => setConfirmDelete(false)}
            title="Delete this prompt, its run history, and its worktree"
          >
            <I.X size={13} /> {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
          {live ? (
            <button type="button" className="btn" onClick={() => void stopRun(live.id).catch(fail)}>
              <I.X size={13} /> Stop run
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void runNow(prompt.id).catch(fail)}
            >
              <I.Bolt size={13} /> Run now
            </button>
          )}
        </div>
      </div>

      <div className="sched-body">
        <RunList prompt={prompt} runs={runs} activeId={active?.id ?? null} onSelect={selectRun} />
        {active ? (
          <RunViewer key={active.id} run={active} />
        ) : (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Clock size={28} />
              </span>
              <div className="title">No runs yet</div>
              <div className="hint">
                {prompt.enabled && prompt.nextRunAt
                  ? `The first run is ${relative(prompt.nextRunAt, now)} — or start one now.`
                  : "This prompt is paused. Run it by hand, or resume its schedule."}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
