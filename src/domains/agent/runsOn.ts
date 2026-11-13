import type { PeerChoice } from "@/domains/peers/hostChoices";
import type { RunsOn } from "@/ipc/agent";

/** Where a ticket's agent runs, as the Start menu and the detail view see it. */
export interface RunsOnState {
  /** Where the next start runs. */
  host: RunsOn;
  /** Vercel is connected or a peer is paired, so the choice is on offer. */
  offered: boolean;
  /** Vercel is connected: the sandbox is one of the choices. */
  sandboxOffered: boolean;
  /** Paired peers, as choices. One that isn't ready has a `reason` and can't be picked. */
  peers: PeerChoice[];
  /** The agent was started elsewhere (sandbox or peer): tabs and actions that need a local
   * worktree go. */
  remote: boolean;
  /** It runs on a peer, whose Capabilities (not the sandbox rule) say which tabs it has. */
  onPeer: boolean;
  /** Why a sandbox can't show as a chat (no Claude login saved for it), if it can't. */
  chatBlock?: string;
  choose: (host: RunsOn) => void;
}

/** Why chat isn't on offer in a sandbox: with no saved Claude login, a headless chat has
 * nowhere to sign in, so it starts as a terminal where the user can. */
export const SANDBOX_CHAT_BLOCK = "Save a Claude login for sandboxes in Integrations first";

/** Why chat isn't on offer on a peer whose server can't show one. */
export const PEER_CHAT_BLOCK = "This computer's trace can't show a chat yet";

/** Which tabs a ticket has, by where it runs. A sandbox has no local worktree: Terminal
 * and Tests go, and Files stays only if the sandbox can read its checkout. A peer says for
 * itself (its Capabilities): `peer` carries what its terminal and tests offer. */
export function ticketTabsFor(
  remote: boolean,
  filesInSandbox: boolean,
  peer?: { terminal: boolean; tests: boolean }
) {
  return {
    files: !remote || filesInSandbox,
    terminal: peer ? peer.terminal : !remote,
    tests: peer ? peer.tests : !remote,
  };
}
