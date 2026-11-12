import { useIssuesStore } from "@/domains/issues/store";
import { interruptedAgents } from "@/ipc/interrupted";
import { listRepos } from "@/ipc/repos";
import { listSessions } from "@/ipc/session";
import type { UsageFacts } from "./prefs";

// Gathers what `alreadySetUp` decides on, from the backend's own files (repos.json,
// sessions, tracker credentials, the interrupted-agents ledger) rather than
// localStorage, which plenty of modules write without the user doing anything.
// A read that fails counts as nothing, so the worst case is showing the first run.

const count = (p: Promise<unknown[]>) => p.then((l) => l.length).catch(() => 0);

export async function usageFacts(): Promise<UsageFacts> {
  const [repos, sessions, interrupted] = await Promise.all([
    count(listRepos()),
    count(listSessions()),
    count(interruptedAgents()),
  ]);
  // trace's own boards are always connected, so they don't count as a tracker set up.
  const trackers = Object.values(useIssuesStore.getState().sessions).filter(
    (s) => s.provider !== "custom"
  ).length;
  return { repos, sessions, trackers, interrupted };
}
