import { save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "@/app/toast";
import { Modal } from "@/components/Modal";
import { exportScheduledPrompts } from "@/ipc/schedules";
import { ShareRow } from "./ShareRow";
import { countLabel, exportFileName, SHARE_FILTERS } from "./share";
import type { ScheduledPrompt } from "./types";

interface ExportModalProps {
  prompts: ScheduledPrompt[];
  onClose: () => void;
}

// Pick prompts to share, then save them to a file someone else can import.
// Everything starts selected.
export function ExportModal({ prompts, onClose }: ExportModalProps) {
  const [picked, setPicked] = useState(() => new Set(prompts.map((p) => p.id)));
  const [busy, setBusy] = useState(false);
  const chosen = prompts.filter((p) => picked.has(p.id));

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    try {
      const path = await save({
        title: "Export scheduled prompts",
        defaultPath: exportFileName(chosen),
        filters: SHARE_FILTERS,
      });
      if (!path) return;
      const count = await exportScheduledPrompts(
        chosen.map((p) => p.id),
        path
      );
      toast.success(`Exported ${countLabel(count)}`);
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export scheduled prompts"
      onClose={onClose}
      className="share-modal"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || chosen.length === 0}
          >
            Export {countLabel(chosen.length)}
          </button>
        </>
      }
    >
      <p className="share-note">
        The file holds each prompt's text, schedule, provider, model and CLI flags. Run history, API
        keys and your repo paths stay on this machine.
      </p>
      <div className="share-list">
        {prompts.map((p) => (
          <ShareRow
            key={p.id}
            prompt={p}
            checked={picked.has(p.id)}
            onToggle={(on) => toggle(p.id, on)}
          />
        ))}
      </div>
    </Modal>
  );
}
