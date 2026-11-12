import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around the board-settings commands: what any board (Jira, Pylon or
// custom) adds to a start, kept by its switcher key (`provider:boardId`) in
// `board-settings.json`.

/** A board's own kickoff brief and repositories. */
export interface BoardSettings {
  /** The board's brief; null or empty uses the global one from Settings. */
  kickoffPrompt: string | null;
  /** Repo paths (from the configured repos) its cards start in; empty: today's rules. */
  repos: string[];
  /** One of `repos`, used when there are several; null asks at the start. */
  defaultRepo: string | null;
}

/** A board's settings: the defaults when none were saved. */
export function boardSettingsGet(boardKey: string): Promise<BoardSettings> {
  return invoke("board_settings_get", { boardKey });
}

/** Save a board's settings; answers them as saved (prompt trimmed, repos checked). */
export function boardSettingsSet(
  boardKey: string,
  settings: BoardSettings
): Promise<BoardSettings> {
  return invoke("board_settings_set", { boardKey, settings });
}
