import { useEffect } from "react";
import { useRichOutputStore } from "@/domains/agent/richOutputStore";
import { useAgentTools } from "@/domains/agentTools/useAgentTools";
import { useBoardStore } from "@/domains/board/store";
import { noteAgentTurn } from "@/domains/board/waitingNotify";
import { noteLiveAsk, noteLiveTurn, useLiveSync } from "@/domains/live/sync";
import { useSessionsStore } from "@/domains/sessions/store";
import { onAgentAsk, onAgentRunState, onAgentTurn, onPtyOutput, onRichHtml } from "@/ipc/events";

/**
 * App-level backend listeners. We capture pty-output here (not in PtyTerminal)
 * so the buffer keeps growing even when the agent detail isn't mounted — that's
 * what makes scrollback survive navigating away and back.
 */
export function useAppEvents(): void {
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const appendOutput = useBoardStore((s) => s.appendOutput);
  useLiveSync();
  useAgentTools();

  useEffect(() => {
    // These listeners register asynchronously (Tauri's `listen` returns a
    // promise). If the effect is torn down before the promise resolves — which
    // StrictMode's mount→unmount→mount does on every dev mount — a naive
    // `unlisten?.()` in cleanup is a no-op (still undefined), the listener leaks,
    // and the next mount adds a *second* one. Two `pty-output` listeners means
    // every chunk is written to the terminal twice (the doubled-output bug). The
    // `cancelled` flag makes a late-resolving registration unlisten immediately.
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    const keep = (p: Promise<() => void>) =>
      void p.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    keep(onAgentRunState((p) => setAgentRunning(p.workspaceId, p.running)));
    keep(onPtyOutput((p) => appendOutput(p.workspaceId, p.data, p.seq)));
    // HTML the agent emits via `trace-render` (out-of-band, bypassing the PTY) —
    // pushed to the rich-output store; the panel renders it in a sandboxed iframe.
    keep(onRichHtml((p) => useRichOutputStore.getState().push(p.issueKey, p.html)));
    // Claude agents' hook-reported turns: tells "busy with background work" from
    // "needs you" (the quiet timer alone can't), and says what the agent asks.
    // What a permission dialog is really for — a question, a plan, a command.
    keep(onAgentAsk(noteLiveAsk));
    keep(
      onAgentTurn((turn) => {
        noteAgentTurn(turn);
        noteLiveTurn(turn);
      })
    );
    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [setAgentRunning, appendOutput]);

  // Load persisted HTML cards once so the HTML tab survives reloads/restarts.
  // Sessions too: Inbox, Fleet, notifications and resumed agents open sessions
  // by workspace id, which fell through to "not on the current board" until the
  // Sessions view had happened to load them.
  useEffect(() => {
    void useRichOutputStore.getState().hydrate();
    if (!useSessionsStore.getState().loaded) void useSessionsStore.getState().load();
  }, []);
}
