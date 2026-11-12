// Which running agents belong to a board. The app's running set holds every live
// workspace: other boards' tickets, standalone sessions, shells. A board's agents are
// the ones whose workspace id is one of its tickets' keys. Pure, so `npm test` can load it.

/** The running workspaces that are this board's tickets. */
export function agentsOnBoard(running: Set<string>, issues: { key: string }[]): Set<string> {
  const keys = new Set(issues.map((i) => i.key));
  return new Set([...running].filter((k) => keys.has(k)));
}
