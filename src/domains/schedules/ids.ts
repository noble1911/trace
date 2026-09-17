// A scheduled run's PTY is keyed `sched:<runId>` (mirrors `schedule::RUN_PREFIX`
// in Rust), so it flows through the same terminal/run-state machinery as issue
// and session workspaces. These helpers keep the prefix in one place.

export const RUN_PREFIX = "sched:";

export function runWorkspaceId(runId: string): string {
  return `${RUN_PREFIX}${runId}`;
}

/** True for a scheduled run's workspace id. */
export function isScheduledRun(workspaceId: string): boolean {
  return workspaceId.startsWith(RUN_PREFIX);
}

/** The run id behind a scheduled run's workspace id, or null for any other id. */
export function runIdOf(workspaceId: string): string | null {
  return isScheduledRun(workspaceId) ? workspaceId.slice(RUN_PREFIX.length) : null;
}
