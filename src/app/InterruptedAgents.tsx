import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { Modal } from "@/components/Modal";
import { useBoardStore } from "@/domains/board/store";
import { relative } from "@/domains/schedules/describe";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import {
  dismissInterruptedAgents,
  type InterruptedAgent,
  interruptedAgents,
  resumeInterruptedAgents,
} from "@/ipc/interrupted";

// On launch: agents that were running when trace last quit, updated or crashed,
// offered back. Resuming carries on each one's conversation; nothing is resent.

type Sessions = ReturnType<typeof useSessionsStore.getState>["sessions"];
type Issues = { key: string; summary: string }[];

function describe(id: string, issues: Issues, sessions: Sessions) {
  for (const session of sessions) {
    const entry = agentRoster(session).find((r) => r.workspaceId === id);
    if (entry) return { title: session.title, sub: `session · ${entry.label}` };
  }
  const issue = issues.find((i) => i.key === id);
  return { title: issue?.summary ?? id, sub: id };
}

export function InterruptedAgents() {
  const [agents, setAgents] = useState<InterruptedAgent[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const issues = useBoardStore((s) => s.data?.issues) ?? [];
  const sessions = useSessionsStore((s) => s.sessions);

  useEffect(() => {
    void interruptedAgents()
      .then((list) => {
        setAgents(list);
        setPicked(new Set(list.map((a) => a.workspaceId)));
      })
      .catch(() => {});
  }, []);

  if (agents.length === 0) return null;

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const dismiss = () => {
    void dismissInterruptedAgents();
    setAgents([]);
  };

  const resume = async () => {
    setBusy(true);
    try {
      const results = await resumeInterruptedAgents([...picked]);
      const failed = results.filter((r) => r.error);
      const ok = results.length - failed.length;
      if (ok) toast.success(`Resumed ${ok === 1 ? "1 agent" : `${ok} agents`}`);
      for (const f of failed) toast.error(`Couldn't resume ${f.workspaceId}: ${f.error}`);
      // The rest weren't picked: let them go too.
      void dismissInterruptedAgents();
      setAgents([]);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  const count = picked.size;
  return (
    <Modal
      title="Resume interrupted agents?"
      onClose={dismiss}
      className="share-modal"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={dismiss}>
            Not now
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void resume()}
            disabled={busy || count === 0}
          >
            Resume {count === 1 ? "1 agent" : `${count} agents`}
          </button>
        </>
      }
    >
      <p className="share-note">
        These were running when trace last closed. Each one carries on its conversation where it
        stopped.
      </p>
      <div className="share-list">
        {agents.map((a) => {
          const { title, sub } = describe(a.workspaceId, issues, sessions);
          const checked = picked.has(a.workspaceId);
          return (
            <div key={a.workspaceId} className={`share-row${checked ? "" : " off"}`}>
              <label className="share-row-main">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(a.workspaceId, e.target.checked)}
                />
                <span className="share-row-text">
                  <span className="share-row-title">{title}</span>
                  <span className="share-row-sub">
                    {sub} · started {relative(a.startedAt)}
                  </span>
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
