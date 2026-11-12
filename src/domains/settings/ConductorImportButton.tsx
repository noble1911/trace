import { useState } from "react";
import { I } from "@/components/Icon";
import { ConductorImportDialog, useConductorAvailable } from "./ConductorImport";

/** What the import brings over, in one sentence for wherever it's offered. */
export const CONDUCTOR_IMPORT_WHAT =
  "Brings over your repositories with their setup scripts, and your workspaces as sessions that carry on their conversations.";

/**
 * The empty Sessions page's offer to import from Conductor: where trace lands with no
 * tracker connected, so what someone arriving from Conductor sees first. Nothing when
 * Conductor isn't on this computer; gone once sessions exist (the page isn't empty).
 */
export function ConductorEmptyOffer() {
  const available = useConductorAvailable();
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <div className="hint">Moving from Conductor? {CONDUCTOR_IMPORT_WHAT}</div>
      <button type="button" className="btn empty-action" onClick={() => setOpen(true)}>
        <I.Download size={14} /> Import from Conductor…
      </button>
      {open && <ConductorImportDialog onClose={() => setOpen(false)} onImported={() => {}} />}
    </>
  );
}
