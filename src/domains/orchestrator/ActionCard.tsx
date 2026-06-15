import { useState } from "react";
import { I } from "@/components/Icon";
import { actionSummary, runWriteTool, WRITE_TOOL_NAMES } from "./mutations";

// An inline, confirm-gated board action requested by the assistant via a
// ```action spec block (the CLI/-p path's equivalent of the SDK's tool use).
// Runs the SAME runWriteTool the SDK tools call, so the effect and the gate are
// identical — only the request mechanism (a text block vs a tool_use) differs.
type Phase = "idle" | "running" | "done" | "declined";

export function ActionCard({ raw }: { raw: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState("");

  let spec: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    spec = parsed as Record<string, unknown>;
  } catch {
    return <div className="chart-err">Couldn't read that action.</div>;
  }

  const action = typeof spec.action === "string" ? spec.action : "";
  if (!WRITE_TOOL_NAMES.has(action)) {
    return <div className="chart-err">Unknown action "{action}".</div>;
  }

  const run = async () => {
    setPhase("running");
    try {
      setResult(await runWriteTool(action, spec));
    } catch (e) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setPhase("done");
  };

  return (
    <div className="orch-action">
      <div className="orch-action-head">
        <I.Bolt size={12} />
        {actionSummary(action, spec)}
      </div>
      {phase === "idle" && (
        <div className="orch-action-foot">
          <button type="button" className="oc-cancel" onClick={() => setPhase("declined")}>
            Skip
          </button>
          <button type="button" className="oc-go" onClick={() => void run()}>
            Confirm
          </button>
        </div>
      )}
      {phase === "running" && <div className="orch-action-result">Running…</div>}
      {phase === "done" && <div className="orch-action-result">{result}</div>}
      {phase === "declined" && <div className="orch-action-result muted">Skipped.</div>}
    </div>
  );
}
