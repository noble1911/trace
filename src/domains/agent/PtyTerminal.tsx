import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { resizeAgent, sendAgentInput } from "@/ipc/agent";
import { onPtyOutput } from "@/ipc/events";

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Renders the interactive Claude TUI for one issue. Streams `pty-output` bytes
// in and forwards keystrokes/resize back through the agent commands.
export function PtyTerminal({ issueKey }: { issueKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'var(--font-mono), "SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: "#050505", foreground: "#ededed", cursor: "#ededed" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const reportSize = () => {
      try {
        fit.fit();
        void resizeAgent(issueKey, term.cols, term.rows);
      } catch {
        // host not measurable yet — the ResizeObserver will fire again
      }
    };
    reportSize();

    const inputSub = term.onData((data) => void sendAgentInput(issueKey, data));
    const ro = new ResizeObserver(reportSize);
    ro.observe(host);

    let unlisten: (() => void) | undefined;
    void onPtyOutput((p) => {
      if (p.workspaceId === issueKey) term.write(decodeBase64(p.data));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      ro.disconnect();
      inputSub.dispose();
      term.dispose();
    };
  }, [issueKey]);

  return (
    <div className="pty-pane">
      <div ref={hostRef} style={{ height: "100%" }} />
    </div>
  );
}
