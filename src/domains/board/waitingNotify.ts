import { notifyOnWaiting, notifySoundOn, notifySoundPath } from "@/domains/agent/defaults";
import { isScheduledRun } from "@/domains/schedules/ids";
import { workspaceTitle } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import type { AgentTurn } from "@/ipc/events";
import { notify } from "@/ipc/notify";
import { playNotifySound } from "@/ipc/sound";
import { useBoardStore } from "./store";

/**
 * Turn-boundary detection for a running agent: when its PTY output goes quiet,
 * flip the status pill to "waiting" and — at most once per turn — fire the
 * native notification.
 *
 * Claude agents also report their turns through hooks (`agent-turn`), which
 * sharpen that guess: quiet while background agents/workflows are still running
 * is "busy", not "needs you"; a permission prompt is "needs you" straight away.
 *
 * This lives beside the board store, not inside it: the store owns state, this
 * owns the timers and the "is this worth interrupting the user for?" policy.
 * The `./store` import is circular by design — both sides only reach for the
 * other from inside a function, never at module scope.
 */

// The status pill flips after a short gap so the board feels live.
const WAITING_AFTER_MS = 1800;

// Notifications wait far longer than the pill does. Claude's TUI animates while
// it works (spinner + elapsed counter), so a stream this quiet really has
// finished its turn — whereas the pill's 1.8s threshold also trips on the pauses
// between tool calls, which is what used to fire notifications mid-turn.
const NOTIFY_AFTER_MS = 8000;

const waitingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Workspaces whose next finished turn is worth a notification. Only the user
 * giving an agent work arms one — typing into its terminal, an orchestrator
 * broadcast, or starting it — and firing consumes it. Output must never re-arm:
 * an idle Claude TUI repaints itself (status line, hook output, the SIGWINCH
 * repaint from opening the session), and counting a repaint as a fresh turn is
 * what made sessions the user hadn't touched notify again and again.
 */
const armed = new Set<string>();

/**
 * Background tasks (agents, shells, workflows) a workspace was still waiting on
 * when its last turn ended. While any are pending, going quiet isn't the turn
 * handing back to the user — the agent wakes itself as they report.
 */
const backgroundPending = new Map<string, number>();

/** Workspaces blocked on a human (permission prompt, …) until the user acts. */
const askingForHuman = new Set<string>();

function busyInBackground(workspaceId: string): boolean {
  return (backgroundPending.get(workspaceId) ?? 0) > 0 && !askingForHuman.has(workspaceId);
}

function clearTimer(timers: Map<string, ReturnType<typeof setTimeout>>, workspaceId: string) {
  const t = timers.get(workspaceId);
  if (t) {
    clearTimeout(t);
    timers.delete(workspaceId);
  }
}

/** The user gave this workspace work — its next quiet stretch may notify. */
export function armWaitingNotify(workspaceId: string): void {
  armed.add(workspaceId);
  askingForHuman.delete(workspaceId);
}

/** Forget a workspace entirely (agent stopped or exited): arming + timers. */
export function cancelWaitingWatch(workspaceId: string): void {
  armed.delete(workspaceId);
  backgroundPending.delete(workspaceId);
  askingForHuman.delete(workspaceId);
  clearTimer(waitingTimers, workspaceId);
  clearTimer(notifyTimers, workspaceId);
}

/**
 * Called for every output chunk: (re)arm the two quiet timers. Both are reset by
 * later output, so only the *last* chunk of a turn gets to fire them.
 */
export function watchForQuiet(workspaceId: string): void {
  clearTimer(waitingTimers, workspaceId);
  waitingTimers.set(
    workspaceId,
    setTimeout(() => {
      waitingTimers.delete(workspaceId);
      if (busyInBackground(workspaceId)) return;
      useBoardStore.getState().setActivity(workspaceId, "waiting");
      refreshPrsFor(workspaceId);
    }, WAITING_AFTER_MS)
  );

  clearTimer(notifyTimers, workspaceId);
  notifyTimers.set(
    workspaceId,
    setTimeout(() => {
      notifyTimers.delete(workspaceId);
      // Checked before the arming is consumed: the notification belongs to the
      // turn that finishes once the background work is done.
      if (busyInBackground(workspaceId)) return;
      maybeNotifyWaiting(workspaceId);
    }, NOTIFY_AFTER_MS)
  );
}

/** An agent's hook-reported turn event (see `AgentTurn`). */
export function noteAgentTurn({ workspaceId, event, backgroundTasks }: AgentTurn): void {
  if (event === "stop") {
    const wasPending = backgroundPending.has(workspaceId);
    if (backgroundTasks > 0) {
      backgroundPending.set(workspaceId, backgroundTasks);
      // A slow Stop hook can land after the pill already flipped: it's busy.
      if (!askingForHuman.has(workspaceId)) {
        useBoardStore.getState().setActivity(workspaceId, "working");
      }
    } else if (wasPending) {
      backgroundPending.delete(workspaceId);
      // The quiet timers may have lapsed (and been skipped) while the Stop hook
      // ran — restart them so this finished turn still counts.
      watchForQuiet(workspaceId);
    }
    return;
  }
  askingForHuman.add(workspaceId);
  useBoardStore.getState().setActivity(workspaceId, "waiting");
  maybeNotifyNeedsInput(workspaceId);
}

/** Claude is blocked on a permission prompt (its own or a background worker's). */
function maybeNotifyNeedsInput(workspaceId: string) {
  if (isScheduledRun(workspaceId)) return;
  // News whether or not the user armed this turn — but it stands in for the
  // turn's quiet-timer notification rather than adding a second one.
  armed.delete(workspaceId);
  alertUnlessWatching(
    workspaceId,
    (title) => `${title} needs you`,
    "The agent is asking for permission to continue."
  );
}

/** Notify that an agent finished its turn — unless the user is watching it. */
function maybeNotifyWaiting(workspaceId: string) {
  // Plain shells (`term:`) are always "waiting"; only agents are news. Scheduled
  // runs announce their own outcome (`schedules/hooks/useScheduleEvents`) — their
  // pauses between tool calls aren't news to anyone.
  if (workspaceId.startsWith("term:") || isScheduledRun(workspaceId)) return;
  // One notification per turn. The arming is consumed even when we go on to stay
  // quiet below, so a turn the user already saw can't resurface on a later
  // repaint — it takes new input from them to arm the next one.
  if (!armed.delete(workspaceId)) return;
  alertUnlessWatching(
    workspaceId,
    (title) => `${title} is waiting`,
    "The agent finished its turn and needs your input."
  );
}

/**
 * Ping the user about `workspaceId` — unless they're already watching it. The
 * notification and the sound are separate switches for the same moment, so
 * either can be on alone.
 */
function alertUnlessWatching(
  workspaceId: string,
  headline: (title: string) => string,
  body: string
) {
  if (!notifyOnWaiting() && !notifySoundOn()) return;
  const { runningAgents, selectedIssueKey } = useBoardStore.getState();
  if (!runningAgents.has(workspaceId)) return;
  const sessions = useSessionsStore.getState();
  // "Watching" is per *agent*, not per session: a session can have several agent
  // tabs and only the one in view counts as seen (`selectedAgentId`).
  const watching =
    document.hasFocus() &&
    (selectedIssueKey === workspaceId || sessions.selectedAgentId === workspaceId);
  if (watching) return;
  playAlertSound();
  if (!notifyOnWaiting()) return;
  // Resolves companion agents too ("Refactor auth · codex"), which otherwise
  // would have announced themselves as a bare workspace id.
  const title = workspaceTitle(sessions.sessions, workspaceId) ?? workspaceId;
  void notify(headline(title), body, workspaceId);
}

/** The configured sound, if any. Best-effort: silence never breaks an alert. */
export function playAlertSound(): void {
  if (!notifySoundOn()) return;
  const path = notifySoundPath();
  if (path) void playNotifySound(path).catch(() => {});
}

/** An agent finishing its turn may have just raised or merged a PR via gh —
 * re-check the issue's dev-status so badges don't go stale. */
function refreshPrsFor(workspaceId: string) {
  if (workspaceId.startsWith("term:")) return;
  const { data, refreshIssuePrs } = useBoardStore.getState();
  const issue = data?.issues.find((i) => i.key === workspaceId);
  if (issue) void refreshIssuePrs(issue.key, issue.id);
}
