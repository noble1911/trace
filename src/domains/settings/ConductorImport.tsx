import { useCallback, useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { Modal } from "@/components/Modal";
import { useSavedPrompts } from "@/domains/savedPrompts/store";
import { useSessionsStore } from "@/domains/sessions/store";
import {
  type ConductorPreview,
  type ConductorReport,
  conductorImportApply,
  conductorImportAvailable,
  conductorImportPreview,
} from "@/ipc/conductorImport";
import { listSavedPrompts } from "@/ipc/savedPrompts";
import { ConductorPreviewList } from "./ConductorPreviewList";
import { ConductorSummary } from "./ConductorSummary";
import { applyDefaults, currentDefaults } from "./conductorDefaults";
import { promptProblems } from "./conductorPromptNames";
import { initialTicks, selectedCount, type Ticks, toSelection } from "./conductorSelection";

// Offered only when Conductor's database is on this computer: on the empty Sessions
// page and in Settings → Repositories (`ConductorImportButton.tsx`), and in its Add
// repository ▾ menu. Four steps: quit Conductor, preview with
// checkboxes, import, then a summary of what was skipped and why.

type Step =
  | { kind: "quit" }
  | { kind: "loading" }
  | { kind: "preview"; preview: ConductorPreview; ticks: Ticks }
  | { kind: "importing" }
  | { kind: "done"; report: ConductorReport };

/** Saved prompts may have been added: load them again so `/` offers them at once. */
function reloadSavedPrompts() {
  listSavedPrompts()
    .then((prompts) => useSavedPrompts.setState({ prompts, loaded: true }))
    .catch(() => {
      // The store keeps what it had; the next launch loads them.
    });
}

/**
 * Whether Conductor's database is on this computer, so "Import from Conductor…"
 * is worth offering. False until it's known (it's a file check in the backend).
 */
export function useConductorAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    conductorImportAvailable()
      .then((yes) => live && setAvailable(yes))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);
  return available;
}

interface ConductorImportDialogProps {
  onClose: () => void;
  /** Repos or sessions may have been added: reload what Settings shows. */
  onImported: () => void;
}

/** The import itself, opened from Repositories' "Add repository…" menu. */
export function ConductorImportDialog({ onClose, onImported }: ConductorImportDialogProps) {
  const [step, setStep] = useState<Step>({ kind: "quit" });
  const busy = step.kind === "loading" || step.kind === "importing";
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const loadPreview = async () => {
    setStep({ kind: "loading" });
    try {
      const preview = await conductorImportPreview();
      if (!preview) {
        toast.error("Conductor's data isn't on this computer any more.");
        onClose();
        return;
      }
      setStep({ kind: "preview", preview, ticks: initialTicks(preview, currentDefaults()) });
    } catch (err) {
      toast.error(`Couldn't read Conductor's data: ${String(err)}`);
      setStep({ kind: "quit" });
    }
  };

  const runImport = async (preview: ConductorPreview, ticks: Ticks) => {
    setStep({ kind: "importing" });
    try {
      const report = await conductorImportApply(toSelection(preview, ticks));
      report.imported.push(...applyDefaults(preview.defaults, ticks.defaults));
      setStep({ kind: "done", report });
      onImported();
      reloadSavedPrompts();
      // Adopted workspaces are new sessions: the Sessions page loaded its list at
      // launch and wouldn't otherwise see them until a restart.
      useSessionsStore
        .getState()
        .load()
        .catch((err) => toast.error(`Couldn't reload your sessions: ${String(err)}`));
    } catch (err) {
      toast.error(`The import stopped: ${String(err)}`);
      setStep({ kind: "preview", preview, ticks });
    }
  };

  return (
    <Modal title="Import from Conductor" onClose={close} className="ci-modal" footer={footer()}>
      {body()}
    </Modal>
  );

  function body() {
    switch (step.kind) {
      case "quit":
        return (
          <div className="ci-intro">
            <p>
              trace brings over your repositories with their setup scripts, your workspaces as
              sessions (each carrying on its latest conversation), your custom prompts and your
              defaults. You choose what comes over on the next step.
            </p>
            <p>
              Quit Conductor before you go on. Importing a workspace moves its folder into trace,
              which would break it in a Conductor that's still running.
            </p>
            <p className="ci-muted">
              Nothing is imported yet: the next step shows what's there. Conductor's data is only
              read, never changed.
            </p>
          </div>
        );
      case "loading":
        return <div className="ci-wait">Reading Conductor's data…</div>;
      case "importing":
        return <div className="ci-wait">Importing…</div>;
      case "preview":
        return (
          <ConductorPreviewList
            preview={step.preview}
            ticks={step.ticks}
            onChange={(ticks) => setStep({ ...step, ticks })}
          />
        );
      case "done":
        return <ConductorSummary report={step.report} />;
    }
  }

  function footer() {
    switch (step.kind) {
      case "quit":
        return (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={() => void loadPreview()}>
              Conductor is closed
            </button>
          </>
        );
      case "preview": {
        const count = selectedCount(step.preview, step.ticks);
        const badNames = Object.keys(promptProblems(step.preview, step.ticks)).length > 0;
        return (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={count === 0 || badNames}
              title={badNames ? "Fix the saved prompt names marked above" : undefined}
              onClick={() => void runImport(step.preview, step.ticks)}
            >
              Import {count} {count === 1 ? "item" : "items"}
            </button>
          </>
        );
      }
      case "done":
        return (
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        );
      default:
        return null;
    }
  }
}
