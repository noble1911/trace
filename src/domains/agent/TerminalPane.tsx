import { useRef, useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { startTerminal, stopAgent } from "@/ipc/agent";
import { PtyTerminal } from "./PtyTerminal";
import { fitTerminal, resetTerminal } from "./terminalRegistry";

// The "Terminal" tab — a plain shell in the issue's worktree, distinct from the
// Claude agent in Chat. Keyed `term:<issue>` so the two PTYs coexist. Reuses the
// same live-terminal/registry machinery as the agent.
export function TerminalPane({ issueKey }: { issueKey: string }) {
  const termKey = `term:${issueKey}`;
  const running = useBoardStore((s) => s.runningAgents.has(termKey));
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const startingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (startingRef.current || running) return;
    startingRef.current = true;
    setError(null);
    const size = fitTerminal(termKey) ?? { cols: 80, rows: 24 };
    clearOutput(termKey);
    resetTerminal(termKey);
    try {
      await startTerminal(issueKey, size.cols, size.rows);
      setAgentRunning(termKey, true);
    } catch (e) {
      setError(String(e));
    } finally {
      startingRef.current = false;
    }
  };
  const stop = async () => {
    await stopAgent(termKey).catch(() => {});
    setAgentRunning(termKey, false);
    clearOutput(termKey);
  };

  return (
    <div className="pty-host-wrap">
      <PtyTerminal issueKey={termKey} />
      {running ? (
        <button type="button" className="term-stop" onClick={stop} title="Close shell">
          <I.X size={12} /> Close
        </button>
      ) : (
        <div className="empty-state">
          <div className="inner">
            <span className="ic">
              <I.Terminal size={28} />
            </span>
            <div className="title">Open a shell in this workspace</div>
            <div className="hint">
              A plain terminal rooted in this workspace's worktree — the same place its agent runs,
              separate from the agent in Chat. Run git, build, or test commands here.
            </div>
            {error && <div style={{ color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>}
            <button type="button" className="btn primary" style={{ marginTop: 6 }} onClick={start}>
              <I.Terminal size={13} /> Open terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
