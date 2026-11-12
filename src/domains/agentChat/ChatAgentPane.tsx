import { useMemo, useRef } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { useChatActions } from "./actions";
import { ChatHeader } from "./ChatHeader";
import { ChatList } from "./ChatList";
import { Composer } from "./Composer";
import { type ChatView, ChatViewContext } from "./chatContext";
import { useAgentWorking, useChat } from "./hooks/useChat";
import { useChatKeys } from "./hooks/useChatKeys";
import { useJournalFeed } from "./hooks/useJournalFeed";
import { useQueueFlush } from "./hooks/useQueueFlush";
import { useWorkspaceRoot } from "./hooks/useWorkspaceRoot";
import { isTurnLive } from "./projection";
import { useAgentChatStore, useJournal } from "./store";
import { isWaitingOnYou } from "./waiting";

interface ChatAgentPaneProps {
  workspaceId: string;
  /** Open every collapsible card (the dev fixture page's screenshot mode). */
  expandAll?: boolean;
  /**
   * Start the stopped agent, the way the view's own Start does (same model,
   * provider, flags and transport). Without it (the fixture page) the agent
   * counts as always running.
   */
  onStart?: () => void;
  /** A record, not an agent to talk to (a finished scheduled run): no composer. */
  readOnly?: boolean;
}

// A chat agent's conversation, the same for every brand: the header's facts, the
// turns (messages, tool calls, diffs, plans, prompts answered in place, a card per
// subagent) and the composer. Each subagent's own conversation is a pane tab after
// this one (`subagentPanel.tsx`). This is the one seam the session and ticket views
// mount; it needs only the workspace id.
export function ChatAgentPane({
  workspaceId,
  expandAll = false,
  onStart,
  readOnly = false,
}: ChatAgentPaneProps) {
  useJournalFeed(workspaceId);
  const actions = useChatActions();
  const live = useBoardStore((s) => s.runningAgents.has(workspaceId));
  const stopped = onStart !== undefined && !live;
  const info = useAgentChatStore((s) => s.info[workspaceId]);
  const loaded = useAgentChatStore((s) => s.loaded[workspaceId] ?? false);
  const { turns, subagents } = useChat(workspaceId);
  const last = turns[turns.length - 1];
  const busy = info?.busy ?? isTurnLive(last);
  const working = useAgentWorking(workspaceId) && !stopped && !readOnly;
  // A question or approval is open: the turn still runs (Stop cancels it), but the
  // screen says it's waiting on you, not working.
  const rows = useJournal(workspaceId).rows;
  const waiting = useMemo(() => isWaitingOnYou(rows), [rows]);
  const running = subagents.filter((s) => s.status === "running").length;
  const root = useWorkspaceRoot(workspaceId);
  const view = useMemo<ChatView>(
    () => ({ workspaceId, root, expandAll }),
    [workspaceId, root, expandAll]
  );
  // Queued messages wait while it's stopped: a send that starts it goes once it's up.
  useQueueFlush(workspaceId, busy || stopped);

  const interrupt = () =>
    void actions
      .interrupt(workspaceId)
      .catch((e) => toast.error(`Couldn't interrupt: ${String(e)}`));
  const paneRef = useRef<HTMLDivElement>(null);
  useChatKeys(paneRef, { working, interrupt });

  return (
    <ChatViewContext.Provider value={view}>
      <div className="ac-pane" ref={paneRef}>
        <ChatHeader info={info} turns={turns} />
        {turns.length === 0 ? (
          <Empty loaded={loaded} stopped={stopped} onStart={onStart} />
        ) : (
          <ChatList
            turns={turns}
            working={working && !waiting}
            since={
              busy && isTurnLive(last) && last ? (last.prompts[0]?.row.at ?? last.startedAt) : null
            }
            subagents={running}
          />
        )}
        {stopped && turns.length > 0 && (
          // Its own band under the conversation, which scrolls above it.
          <div className="ac-stopped">
            <div className="ac-stopped-in">
              <span>The agent isn't running. Send a message or start it to carry on.</span>
              <button type="button" className="btn" onClick={onStart}>
                <I.Play size={14} /> Start
              </button>
            </div>
          </div>
        )}
        {!readOnly && (
          <Composer
            workspaceId={workspaceId}
            busy={busy}
            working={working}
            waiting={waiting}
            onInterrupt={interrupt}
            slashCommands={info?.slashCommands ?? []}
            running={!stopped}
            onStart={stopped ? onStart : undefined}
          />
        )}
      </div>
    </ChatViewContext.Provider>
  );
}

function Empty({
  loaded,
  stopped,
  onStart,
}: {
  loaded: boolean;
  stopped: boolean;
  onStart?: () => void;
}) {
  if (!loaded) {
    return (
      <div className="tx-empty">
        <div className="ib-empty">Reading the conversation…</div>
      </div>
    );
  }
  return (
    <div className="tx-empty">
      <div className="ib-empty ac-empty">
        {stopped
          ? "The agent isn't running. Send it a message to start it, or start it now."
          : "Nothing here yet. Your messages and the agent's work will show up here."}
        {stopped && onStart && (
          <button type="button" className="btn" onClick={onStart}>
            <I.Play size={14} /> Start
          </button>
        )}
      </div>
    </div>
  );
}
