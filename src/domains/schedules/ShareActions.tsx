import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { readScheduledPromptsFile } from "@/ipc/schedules";
import { ExportModal } from "./ExportModal";
import { ImportModal } from "./ImportModal";
import { SHARE_FILTERS } from "./share";
import type { ImportItem, ScheduledPrompt } from "./types";

interface ShareActionsProps {
  prompts: ScheduledPrompt[];
}

// The Scheduled page's Import / Export buttons and the modals behind them.
// Import reads the file first, so a wrong file fails on a toast before any
// preview opens.
export function ShareActions({ prompts }: ShareActionsProps) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<ImportItem[] | null>(null);

  const pickFile = async () => {
    try {
      const path = await open({
        title: "Import scheduled prompts",
        multiple: false,
        directory: false,
        filters: SHARE_FILTERS,
      });
      if (typeof path !== "string") return;
      setImporting(await readScheduledPromptsFile(path));
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => void pickFile()}>
        <I.Download size={14} /> Import
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => setExporting(true)}
        disabled={prompts.length === 0}
        title={prompts.length ? "Save prompts to a file you can share" : "Nothing to export yet"}
      >
        <I.Upload size={14} /> Export
      </button>
      {exporting && <ExportModal prompts={prompts} onClose={() => setExporting(false)} />}
      {importing && <ImportModal items={importing} onClose={() => setImporting(null)} />}
    </>
  );
}
