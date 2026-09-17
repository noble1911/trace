import { useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { useNow } from "./hooks/useNow";
import { ScheduleDetail } from "./ScheduleDetail";
import { ScheduleModal } from "./ScheduleModal";
import { ScheduleRow } from "./ScheduleRow";
import { useSchedulesStore } from "./store";
import type { ScheduledPrompt } from "./types";

// The Scheduled page: every scheduled prompt with its next firing and last run.
// Opening one shows its full-screen detail (run history + conversations). Data
// is loaded and kept live app-wide by `useScheduleEvents`.
export function SchedulesView() {
  const prompts = useSchedulesStore((s) => s.prompts);
  const runs = useSchedulesStore((s) => s.runs);
  const loaded = useSchedulesStore((s) => s.loaded);
  const openPromptId = useSchedulesStore((s) => s.openPromptId);
  const open = useSchedulesStore((s) => s.open);
  const setEnabled = useSchedulesStore((s) => s.setEnabled);
  const runNow = useSchedulesStore((s) => s.runNow);
  // "new" = the create form; a prompt = its edit form.
  const [editing, setEditing] = useState<ScheduledPrompt | "new" | null>(null);
  const now = useNow(30_000);

  const openPrompt = prompts.find((p) => p.id === openPromptId) ?? null;
  const fail = (err: unknown) => toast.error(String(err));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scheduled</h1>
          <div className="desc">
            Prompts that run themselves on a schedule, each in its own worktree. They fire while
            trace is open.
          </div>
        </div>
        <div className="right">
          <button type="button" className="btn primary" onClick={() => setEditing("new")}>
            <I.Plus size={14} /> New scheduled prompt
          </button>
        </div>
      </div>
      <div className="page-body">
        {loaded && prompts.length === 0 ? (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Clock size={28} />
              </span>
              <div className="title">Nothing scheduled yet</div>
              <div className="hint">
                Have an agent triage PRs every morning, check CI every hour, or write a weekly
                summary. Every run is saved, so you can read the conversation or pick it up as a
                session.
              </div>
              <button
                type="button"
                className="btn primary"
                style={{ marginTop: 6 }}
                onClick={() => setEditing("new")}
              >
                <I.Plus size={13} /> New scheduled prompt
              </button>
            </div>
          </div>
        ) : (
          <div className="sched-list">
            {prompts.map((p) => (
              <ScheduleRow
                key={p.id}
                prompt={p}
                lastRun={runs.find((r) => r.promptId === p.id)}
                now={now}
                onOpen={() => open(p.id)}
                onToggle={(enabled) => void setEnabled(p.id, enabled).catch(fail)}
                onRunNow={() => void runNow(p.id).catch(fail)}
              />
            ))}
          </div>
        )}
      </div>

      {openPrompt && <ScheduleDetail prompt={openPrompt} onEdit={() => setEditing(openPrompt)} />}
      {editing && (
        <ScheduleModal
          prompt={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
