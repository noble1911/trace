import { useEffect, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { ConfirmPrompt } from "@/components/InlineConfirm";
import { type MenuItem, MoreTrigger, PopMenu } from "@/components/PopMenu";
import { StatusLight } from "@/components/StatusLight";
import { editorItems } from "@/domains/agent/editorItems";
import { shownAsk } from "@/domains/live/light";
import { useAgentQuiet } from "@/domains/live/quietStore";
import { useLiveStore } from "@/domains/live/store";
import type { WorkspaceInfo } from "@/ipc/workspace";
import { basename } from "@/platform/paths";
import type { RosterEntry } from "./agentRoster";
import { CreatorChip } from "./CreatorChip";
import { creatorOf } from "./createdBy";
import { HostChip } from "./HostChip";
import type { AgentRun } from "./hooks/useAgentRun";
import { SessionRunButton } from "./SessionRunButton";
import { hostId, hostPlace } from "./sessionHost";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

interface SessionHeaderProps {
  session: ScratchSession;
  /** The page Back returns to ("Inbox", "Sessions", …). */
  backLabel: string;
  onBack: () => void;
  /** Repo + live branch, once read. */
  info: WorkspaceInfo | null;
  /** The agent the header acts on: the one last in focus. */
  active: RosterEntry;
  run: AgentRun;
  /** The active agent ended by itself: offer a restart. */
  exited: boolean;
  /** Leave a remote agent working and let go of it. */
  onDisconnect: () => void;
  /** Restart, Open in terminal / as chat (`agentChat/agentMenu`). */
  agentItems: MenuItem[];
  /** The pane layout's own (Reset layout). */
  layoutItems: MenuItem[];
  onLink: () => void;
  /** Remove the active companion agent, once confirmed here. */
  onRemoveAgent: () => void;
}

/** The header's "where": repo · branch here, or the sandbox and its repo on Vercel. */
function where(info: WorkspaceInfo | null, session: ScratchSession): string {
  if (info) return [basename(info.repo), info.branch].filter(Boolean).join(" · ");
  return session.host ? hostPlace(session.host) : " ";
}

// A session's detail header: where it runs, who started it, its title (renamed in
// place), then status → the run control → ⋯. Removing a companion is armed from ⋯
// and confirmed inline here; Stop drops to its icon when the header is narrow.
export function SessionHeader({
  session,
  backLabel,
  onBack,
  info,
  active,
  run,
  exited,
  onDisconnect,
  agentItems,
  layoutItems,
  onLink,
  onRemoveAgent,
}: SessionHeaderProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rename = useSessionsStore((s) => s.rename);
  const live = useLiveStore((s) => s.info[active.workspaceId]);
  const quiet = useAgentQuiet(active.workspaceId);
  // Arming "remove" is for the agent in view; another taking the header disarms it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the agent changes
  useEffect(() => setConfirmRemove(false), [active.workspaceId]);

  return (
    <div className="detail-top">
      <BackButton label={backLabel} onBack={onBack} />
      <span className="session-avatar">
        <I.Sparkles size={16} />
      </span>
      <div>
        <span className="id" title={info?.cwd ?? (session.host ? hostId(session.host) : undefined)}>
          {where(info, session)}
        </span>
        <CreatorChip createdBy={creatorOf(session)} variant="detail" />
        {session.host && <HostChip host={session.host} />}
        {renaming ? (
          <TitleEditor
            initial={session.title}
            onSave={(title) => void rename(session.id, title)}
            onClose={() => setRenaming(false)}
          />
        ) : (
          <div className="ttl">
            {session.title}
            <IconButton
              size="xs"
              className="ghost ttl-edit"
              label="Rename session"
              onClick={() => setRenaming(true)}
            >
              <I.Pencil size={12} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="right">
        {/* The viewed agent's real state — "working" only mid-turn, not whenever its PTY lives. */}
        {run.running && (
          <StatusLight
            light={live?.light ?? "stopped"}
            quiet={quiet}
            label={shownAsk(live)?.label}
            variant="pill"
            size="lg"
          />
        )}
        {confirmRemove && (
          <ConfirmPrompt
            onCancel={() => setConfirmRemove(false)}
            message="Stops this agent and forgets its conversation; the worktree stays."
            confirmLabel={
              <>
                <I.Trash size={14} /> Remove {active.label}
              </>
            }
            onConfirm={() => {
              setConfirmRemove(false);
              onRemoveAgent();
            }}
          />
        )}
        <SessionRunButton
          agentName={active.label}
          running={run.running}
          exited={exited}
          remote={Boolean(session.host)}
          onStart={() => void run.start()}
          onStop={() => run.stop()}
          onDisconnect={onDisconnect}
        />
        <PopMenu
          trigger={({ open, toggle }) => (
            <MoreTrigger open={open} toggle={toggle} label="More actions" />
          )}
          sections={[
            // A remote host's files aren't on this computer to open.
            ...(session.host
              ? []
              : [
                  { title: session.folder ? "Folder" : "Worktree", items: editorItems(session.id) },
                ]),
            { title: active.label, items: agentItems },
            {
              title: "Session",
              items: [
                ...(session.worktree ? [{ label: "Link to ticket…", onSelect: onLink }] : []),
                ...(active.companion
                  ? [
                      {
                        label: `Remove ${active.label} agent`,
                        danger: true,
                        onSelect: () => setConfirmRemove(true),
                      },
                    ]
                  : []),
              ],
            },
            { title: "Layout", items: layoutItems },
          ]}
        />
      </div>
    </div>
  );
}
