import { useNow } from "@/hooks/useNow";
import { useSandboxState } from "./hooks/useSandboxState";
import { SandboxPreviews } from "./SandboxPreviews";
import { sandboxFacts } from "./sessionHost";
import type { SessionHost } from "./types";

/** The Vercel variant: the only host this section describes. */
type VercelHost = Extract<SessionHost, { kind: "vercel" }>;

interface SandboxSectionProps {
  sessionId: string;
  host: VercelHost;
  /** This trace has the agent open (its terminal or chat is attached). */
  attached: boolean;
}

// "Sandbox" in a sandbox session's Details: which sandbox and repo, and what
// state the sandbox is in — running (attached or unattended), saved as a
// snapshot, or expired — with the time left when Vercel says. It isn't agent
// state, so it's words, never a StatusLight.
export function SandboxSection({ sessionId, host, attached }: SandboxSectionProps) {
  const state = useSandboxState(sessionId, attached);
  // Minutes are the finest the time left is told in.
  const now = useNow(30_000) * 1000;
  const facts = state ? sandboxFacts(state, attached, now) : null;
  return (
    <div className="ctx-section">
      <div className="label">Sandbox</div>
      <div className="ctx-row">
        <span className="k">Runs in</span>
        <span className="v plain">Vercel Sandbox</span>
      </div>
      {host.remote && (
        <div className="ctx-row">
          <span className="k">Repository</span>
          <span className="v" title={host.remote}>
            {host.remote}
          </span>
        </div>
      )}
      <div className="ctx-row">
        <span className="k">Sandbox</span>
        <span className="v" title={host.sandbox}>
          {host.sandbox}
        </span>
      </div>
      <div className="ctx-row">
        <span className="k">State</span>
        <span className="v plain">{facts?.state ?? "Checking…"}</span>
      </div>
      {facts && <div className="sandbox-note">{facts.detail}</div>}
      {state?.status === "running" && (
        <SandboxPreviews sessionId={sessionId} previews={state.previews ?? []} />
      )}
    </div>
  );
}
