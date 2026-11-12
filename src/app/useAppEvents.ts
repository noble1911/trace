import { useEffect } from "react";
import { toast } from "@/app/toast";
import { noteRunState } from "@/domains/agent/exitedStore";
import { ensureChatListeners } from "@/domains/agentChat/hooks/useJournalFeed";
import { syncChatActivity } from "@/domains/agentChat/liveBridge";
import { startSubagentAutoClose } from "@/domains/agentChat/subagentAutoClose";
import { hydrateChatState, isChatAgent, loadChatBrands } from "@/domains/agentChat/transport";
import { useAgentTools } from "@/domains/agentTools/useAgentTools";
import { adoptLiveAgents } from "@/domains/board/adopt";
import { useBoardStore } from "@/domains/board/store";
import { askIsOver, noteAgentTurn } from "@/domains/board/waitingNotify";
import { userActed } from "@/domains/live/answer";
import { clearLiveUpdate, noteLiveAsk, noteLiveTurn, useLiveSync } from "@/domains/live/sync";
import { usePlanStore } from "@/domains/plans/store";
import { useSessionsStore } from "@/domains/sessions/store";
import {
  onAgentAnswered,
  onAgentAsk,
  onAgentPrompt,
  onAgentRunState,
  onAgentTurn,
  onPtyOutput,
} from "@/ipc/events";
import { onPlanDoc, onPlanTasks } from "@/ipc/plans";
import { useViewerEvents } from "./useViewerEvents";

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
  useViewerEvents();

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
    // Chat agents' rows and info, from the start: they drive the board and
    // notifications for chat agents whose view isn't open (`agentChat/liveBridge`).
    ensureChatListeners();
    loadChatBrands();
    const runState = onAgentRunState((p) => {
      setAgentRunning(p.workspaceId, p.running);
      noteRunState(p);
      // A chat agent resumed with nothing to do (after a quit) is idle, not working.
      if (p.running && isChatAgent(p.workspaceId)) syncChatActivity(p.workspaceId);
    });
    keep(runState);
    // A reload empties the run-state while the backend's PTYs survive it. Only once
    // exits can reach us: one that landed before this was listening is already off
    // the backend's list, and a later one can't be missed (`adopt` checks for it).
    void runState.then(() => {
      if (cancelled) return;
      void adoptLiveAgents()
        .then((ids) => {
          // A chat agent's busy state and transport, so its light is right after a reload.
          for (const id of ids) if (!id.startsWith("term:")) hydrateChatState(id);
        })
        .catch(() => {});
    });
    keep(onPtyOutput((p) => appendOutput(p.workspaceId, p.data, p.seq)));
    // The Plan tab's documents land backend-side (plan mode, trace-render,
    // publish_document); a workspace already shown reloads to pick them up.
    keep(
      onPlanDoc((p) => {
        const plans = usePlanStore.getState();
        if (plans.loaded[p.workspaceId]) void plans.reload(p.workspaceId);
      })
    );
    keep(onPlanTasks((p) => usePlanStore.getState().setTasks(p.workspaceId, p.tasks)));
    // Claude agents' hook-reported turns: tells "busy with background work" from
    // "needs you" (the quiet timer alone can't), and says what the agent asks.
    // What a permission dialog is really for — a question, a plan, a command.
    keep(onAgentAsk(noteLiveAsk));
    // ...and when that dialog was answered, wherever (a click, Remote Control).
    keep(onAgentAnswered((p) => userActed(p.workspaceId)));
    keep(
      onAgentPrompt((p) => {
        askIsOver(p.workspaceId);
        clearLiveUpdate(p.workspaceId);
      })
    );
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

  // Finished subagents' tabs nobody opened close after a while (Settings → Tabs).
  useEffect(() => startSubagentAutoClose(), []);

  // Load sessions once: Inbox, Fleet, notifications and resumed agents open sessions
  // by workspace id, which fell through to "not on the current board" until the
  // Sessions view had happened to load them.
  useEffect(() => {
    if (!useSessionsStore.getState().loaded) {
      useSessionsStore
        .getState()
        .load()
        .catch((err) => toast.error(`Couldn't load your sessions: ${String(err)}`));
    }
  }, []);
}
