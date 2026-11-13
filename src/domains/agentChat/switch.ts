import { useBoardStore } from "@/domains/board/store";
import { useLiveStore } from "@/domains/live/store";
import { agentRunning, stopAgent } from "@/ipc/agent";
import { useAgentChatStore } from "./store";
import type { Transport } from "./types";
import { isWorkingInfo } from "./working";

// Restarting an agent, and moving one between the chat and the terminal ("Open
// in terminal" / "Open as chat"). Both are a stop, a wait for the process to be
// gone (one conversation can't have two processes), and a start: the start
// `--resume`s the same saved conversation, whichever transport it's on.

const STOP_WAIT_MS = 10_000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stop the workspace's agent and wait until its process has ended. */
export async function stopAndWait(workspaceId: string): Promise<void> {
  await stopAgent(workspaceId);
  const deadline = Date.now() + STOP_WAIT_MS;
  while (await agentRunning(workspaceId)) {
    if (Date.now() > deadline) throw new Error("the agent didn't stop in time");
    await pause(150);
  }
  useBoardStore.getState().setAgentRunning(workspaceId, false);
}

/**
 * Why the agent can't move to `to` right now, or null when it can. Only an idle
 * agent moves: one mid-turn would lose the turn, and a prompt it's waiting on
 * would be cut off.
 */
export function switchBlocker(workspaceId: string, to: Transport): string | null {
  const running = useBoardStore.getState().runningAgents.has(workspaceId);
  if (!running) return null;
  const live = useLiveStore.getState().info[workspaceId];
  if (live?.ask) return "it's waiting for an answer";
  if (to === "terminal") {
    const info = useAgentChatStore.getState().info[workspaceId];
    if (isWorkingInfo(info)) return "it's working";
    return null;
  }
  if (useBoardStore.getState().agentActivity[workspaceId] !== "waiting") return "it's working";
  return null;
}

/** `switchBlocker` as a hook, for menus. */
export function useSwitchBlocker(workspaceId: string, to: Transport): string | null {
  useBoardStore((s) => s.agentActivity[workspaceId]);
  useBoardStore((s) => s.runningAgents.has(workspaceId));
  useLiveStore((s) => s.info[workspaceId]?.ask);
  useAgentChatStore((s) => isWorkingInfo(s.info[workspaceId]));
  return switchBlocker(workspaceId, to);
}
