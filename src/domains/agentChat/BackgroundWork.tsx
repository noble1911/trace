import { useCallback, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { MenuCaret } from "@/components/MenuCaret";
import { StatusLight } from "@/components/StatusLight";
import { useDismiss } from "@/hooks/useDismiss";
import { useChatActions } from "./actions";
import { type BackgroundItem, kindWord } from "./background";
import { formatDuration } from "./format";
import { useNow } from "./hooks/useNow";
import { showSubagentTab } from "./subagentPanel";

// The fact strip's note of what's still running behind the conversation: a
// small "Background 3" control, shown only while something runs, that opens a
// list of it. A subagent's row opens its tab; a shell, monitor or workflow has
// no tab — the list is where it's seen — and any of them can be stopped here.

interface BackgroundWorkProps {
  workspaceId: string;
  items: BackgroundItem[];
}

export function BackgroundWork({ workspaceId, items }: BackgroundWorkProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrapRef, open, close);
  if (items.length === 0) return null;
  return (
    <div className="pop-menu ac-bg" ref={wrapRef}>
      <button
        type="button"
        className="btn xs ac-bg-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Background <span className="ac-bg-count">{items.length}</span>
        <MenuCaret size="xs" />
      </button>
      {open && <BackgroundList workspaceId={workspaceId} items={items} onClose={close} />}
    </div>
  );
}

function BackgroundList({
  workspaceId,
  items,
  onClose,
}: BackgroundWorkProps & { onClose: () => void }) {
  const actions = useChatActions();
  const now = useNow(true);
  const stop = (item: BackgroundItem) => {
    if (!item.callId) return;
    void actions
      .stopSubagent(workspaceId, item.callId)
      .catch((e) => toast.error(`Couldn't stop it: ${String(e)}`));
  };
  return (
    <div
      className="pop-menu-pop left ac-bg-pop"
      role="dialog"
      aria-label="Running in the background"
    >
      <div className="pop-menu-head">Running in the background</div>
      <ul className="ac-bg-list">
        {items.map((item) => (
          <li key={item.key} className="ac-bg-row">
            <span className="ac-bg-kind">{kindWord(item.kind)}</span>
            {item.kind === "subagent" && item.callId ? (
              <button
                type="button"
                className="ac-bg-name ac-bg-open"
                title={item.label}
                onClick={() => {
                  onClose();
                  if (item.callId) showSubagentTab(workspaceId, item.callId);
                }}
              >
                {item.label}
              </button>
            ) : (
              <span className="ac-bg-name" title={item.label}>
                {item.label}
              </span>
            )}
            {item.pending && <StatusLight light="attention" variant="word" dotless />}
            <span className="ac-bg-age">{formatDuration(Math.max(0, now - item.startedAt))}</span>
            {item.callId ? (
              <IconButton size="xs" label="Stop" onClick={() => stop(item)}>
                <I.Stop size={12} />
              </IconButton>
            ) : (
              <span className="ac-bg-nostop" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
