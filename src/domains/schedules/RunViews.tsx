import { useState } from "react";
import { I } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import { Segmented } from "@/components/Segmented";
import { PtyTerminal } from "@/domains/agent/PtyTerminal";
import { ChatAgentPane } from "@/domains/agentChat/ChatAgentPane";
import { runWorkspaceId } from "./ids";
import { PromptView } from "./PromptView";
import { RunConversation } from "./RunConversation";
import type { ScheduledPrompt, ScheduleRun } from "./types";

type RunView = "summary" | "log" | "terminal" | "chat" | "prompt";

interface RunViewsProps {
  run: ScheduleRun;
  prompt: ScheduledPrompt;
  live: boolean;
}

// The views of a run that got as far as starting its agent, one at a time so
// each gets the full height: Claude's closing summary (the default for a
// finished run — it's the answer), then the run itself. A terminal run has the
// conversation as scrollable text (read from Claude's own log, since the PTY
// recording can only replay the TUI's last screen) and the terminal, which a
// live run can be typed into. A chat run has its chat, answered in place while
// it's live and kept as its journal after. Last, the prompt.
export function RunViews({ run, prompt, live }: RunViewsProps) {
  const ws = runWorkspaceId(run.id);
  const chat = run.transport === "chat";
  const agentView: RunView = chat ? "chat" : "terminal";
  // A live run opens on the agent (the chat, or a terminal you may need to
  // answer); a finished one on its summary; otherwise the conversation.
  const [picked, setView] = useState<RunView>(
    live && (chat || !run.claudeSessionId)
      ? agentView
      : run.summary
        ? "summary"
        : chat
          ? "chat"
          : "log"
  );
  // The Summary tab only exists once there is one.
  const view: RunView = picked === "summary" && !run.summary ? (chat ? "chat" : "log") : picked;

  const summary = {
    value: "summary" as const,
    label: (
      <>
        <I.Sparkles size={14} /> Summary
      </>
    ),
    title: "Claude's closing message for this run",
  };
  const runOptions = chat
    ? [
        {
          value: "chat" as const,
          label: (
            <>
              <I.Chat size={14} /> Chat
            </>
          ),
          title: live ? "Answer the agent here" : undefined,
        },
      ]
    : [
        {
          value: "log" as const,
          label: (
            <>
              <I.Chat size={14} /> Conversation
            </>
          ),
        },
        {
          value: "terminal" as const,
          label: (
            <>
              <I.Terminal size={14} /> Terminal
            </>
          ),
          title: live
            ? "Type here to answer the agent"
            : "The recorded terminal (last screen only)",
        },
      ];

  return (
    <>
      <div className="sched-views">
        <Segmented<RunView>
          label="Show"
          value={view}
          options={[
            ...(run.summary ? [summary] : []),
            ...runOptions,
            {
              value: "prompt",
              label: (
                <>
                  <I.File size={14} /> Prompt
                </>
              ),
              title: "The prompt this run was sent, and how it runs",
            },
          ]}
          onChange={setView}
        />
      </div>

      {view === "summary" && run.summary && (
        <div className="sched-summary">
          <Markdown text={run.summary} />
        </div>
      )}
      {view === "prompt" && <PromptView prompt={prompt} sent={run.prompt} />}
      {view === "chat" && (
        <div className="sched-chat">
          <ChatAgentPane workspaceId={ws} readOnly={!live} />
        </div>
      )}
      {view === "log" && run.claudeSessionId && <RunConversation run={run} />}
      {view === "log" && !run.claudeSessionId && (
        <div className="empty-state">
          <div className="inner">
            <div className="title">No conversation</div>
            <div className="hint">This run never got as far as starting one.</div>
          </div>
        </div>
      )}
      {view === "terminal" &&
        (live || run.hasTranscript ? (
          <div className="pty-host-wrap">
            <PtyTerminal issueKey={ws} />
          </div>
        ) : (
          <div className="empty-state">
            <div className="inner">
              <div className="title">No output recorded</div>
              <div className="hint">This run ended before its agent printed anything.</div>
            </div>
          </div>
        ))}
    </>
  );
}
