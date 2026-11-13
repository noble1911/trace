import type { RunsOn } from "@/ipc/agent";

/** Where a ticket's agent runs, as the Start menu and the detail view see it. */
export interface RunsOnState {
  /** Where the next start runs. */
  host: RunsOn;
  /** Vercel is connected, so the choice is on offer. */
  offered: boolean;
  /** The agent was started in a sandbox: tabs and actions that need a local worktree go. */
  remote: boolean;
  /** Why a sandbox can't show as a chat (no Claude login saved for it), if it can't. */
  chatBlock?: string;
  choose: (host: RunsOn) => void;
}

/** Why chat isn't on offer in a sandbox: with no saved Claude login, a headless chat has
 * nowhere to sign in, so it starts as a terminal where the user can. */
export const SANDBOX_CHAT_BLOCK = "Save a Claude login for sandboxes in Integrations first";

/** Which tabs a ticket has, by where it runs. A sandbox has no local worktree: Terminal
 * and Tests go, and Files stays only if the sandbox can read its checkout. */
export function ticketTabsFor(remote: boolean, filesInSandbox: boolean) {
  return {
    files: !remote || filesInSandbox,
    terminal: !remote,
    tests: !remote,
  };
}
