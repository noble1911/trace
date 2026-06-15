import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icon";
import { type ChatMessage, useChatStore } from "./chatStore";

const QUICK = [
  "Summarize the sprint",
  "What should I play next?",
  "What's blocked right now?",
  "Which agents are waiting on me?",
];

const TOOL_LABEL: Record<string, string> = {
  get_ticket_details: "ticket details",
  get_agent_transcript: "an agent transcript",
};

// The orchestrator chat tab. Streams the assistant reply token-by-token and
// shows a live status line while it reads a tool. State lives in chatStore;
// this is presentational.
export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const busy = useChatStore((s) => s.busy);
  const error = useChatStore((s) => s.error);
  const send = useChatStore((s) => s.send);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as it streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft("");
    void send(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter keeps the textarea's default newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  const last = messages.length - 1;

  return (
    <div className="orch-chat">
      <div className="orch-msgs" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="orch-chat-intro">
            <I.Sparkles size={20} />
            <div className="t">Ask about the board</div>
            <div className="orch-quick">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => submit(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Message key={`${m.role}-${i}`} msg={m} streaming={busy && i === last} />
          ))
        )}
      </div>

      {error && messages.length === 0 && <div className="orch-chat-error">{error}</div>}

      {pendingConfirm && (
        <div className="orch-confirm">
          <div className="orch-confirm-head">
            <I.Bolt size={12} /> Confirm action
          </div>
          <div className="orch-confirm-body">{pendingConfirm.summary}</div>
          <div className="orch-confirm-actions">
            <button type="button" className="oc-cancel" onClick={() => resolveConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="oc-go" onClick={() => resolveConfirm(true)}>
              Confirm
            </button>
          </div>
        </div>
      )}

      <div className="orch-input-row">
        <textarea
          className="orch-input"
          placeholder="Ask the orchestrator…"
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="orch-send"
          onClick={() => submit(draft)}
          disabled={busy || !draft.trim()}
          aria-label="Send"
        >
          <I.Send size={14} />
        </button>
      </div>
    </div>
  );
}

function Message({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  const thinking = streaming && !msg.text && !msg.tool;
  return (
    <div className={`msg ${msg.role}`}>
      <div className="who">{msg.role === "user" ? "You" : "Orchestrator"}</div>
      <div className="body">
        {msg.text}
        {msg.tool && (
          <span className="orch-tool">↳ reading {TOOL_LABEL[msg.tool] ?? msg.tool}…</span>
        )}
        {thinking && <span className="orch-typing">thinking…</span>}
      </div>
    </div>
  );
}
