// A board's repos at a start, as the frontend needs them. The backend makes the actual
// choice (`start_agent` with the board key): the ticket's saved repo, else the board's
// (one: it; several: the default, else ask), else today's rules. These mirror that, for
// the repo picker (only the board's, default first) and the ticket's Start prompt.

/** The repo part of a board's settings. */
export interface BoardRepos {
  repos: string[];
  defaultRepo: string | null;
}

export type RepoDecision =
  /** The board says nothing: mappings, the sole repo, or ask among all of them. */
  | { kind: "rules" }
  /** The board settles it. */
  | { kind: "use"; repo: string }
  /** Several and no default: ask, among these. */
  | { kind: "pick"; repos: string[] };

/** The board's repos that are still configured, in the board's order. */
export function boardRepos(board: BoardRepos | null, configured: string[]): string[] {
  return board ? board.repos.filter((r) => configured.includes(r)) : [];
}

/** What a board's settings decide for a ticket with no saved repo. */
export function decideRepo(board: BoardRepos | null, configured: string[]): RepoDecision {
  const repos = boardRepos(board, configured);
  if (repos.length === 0) return { kind: "rules" };
  if (repos.length === 1) return { kind: "use", repo: repos[0] };
  const fallback = board?.defaultRepo;
  if (fallback && repos.includes(fallback)) return { kind: "use", repo: fallback };
  return { kind: "pick", repos };
}

/** The repo picker's rows: only the board's when it has some (its default first and
 * preselected), else every configured repo. */
export function pickerRepos(
  board: BoardRepos | null,
  configured: string[]
): { repos: string[]; preselected: string | null } {
  const repos = boardRepos(board, configured);
  if (repos.length === 0) return { repos: configured, preselected: null };
  const decision = decideRepo(board, configured);
  const preselected = decision.kind === "use" ? decision.repo : null;
  const ordered = preselected ? [preselected, ...repos.filter((r) => r !== preselected)] : repos;
  return { repos: ordered, preselected };
}

/** The ticket Start prompt's repos and its first pick: the saved repo wins, then the
 * board's choice; a saved repo outside the board's list stays offered. */
export function startPromptRepos(
  board: BoardRepos | null,
  configured: string[],
  assigned: string | null
): { repos: string[]; choice: string } {
  const { repos } = pickerRepos(board, configured);
  const offered = assigned && !repos.includes(assigned) ? [assigned, ...repos] : repos;
  return { repos: offered, choice: assigned ?? offered[0] ?? "" };
}

/** A board's repos after toggling one: the default stays only while it's picked and
 * there's more than one (a single repo needs no default). */
export function toggleRepo(current: BoardRepos, repo: string): BoardRepos {
  const repos = current.repos.includes(repo)
    ? current.repos.filter((r) => r !== repo)
    : [...current.repos, repo];
  return { repos, defaultRepo: normalDefault(repos, current.defaultRepo) };
}

/** Make `repo` the default, or clear it when it already is. */
export function toggleDefault(current: BoardRepos, repo: string): BoardRepos {
  const next = current.defaultRepo === repo ? null : repo;
  return { repos: current.repos, defaultRepo: normalDefault(current.repos, next) };
}

function normalDefault(repos: string[], defaultRepo: string | null): string | null {
  return repos.length > 1 && defaultRepo && repos.includes(defaultRepo) ? defaultRepo : null;
}
