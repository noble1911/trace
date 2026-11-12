import { boardSettingsGet } from "@/ipc/boardSettings";
import { customBoardConfig } from "@/ipc/customBoards";
import type { BoardSetupText } from "./boardFormat";
import { parseBoardRef } from "./boardRef";

/**
 * A board's settings and (custom boards) card types for `get_board`. Best-effort: a read
 * that fails leaves that part out, and the tool still answers.
 */
export async function loadBoardSetup(boardKey: string): Promise<BoardSetupText> {
  const ref = parseBoardRef(boardKey);
  const [settings, config] = await Promise.all([
    boardSettingsGet(boardKey).catch(() => null),
    ref?.provider === "custom" ? customBoardConfig(ref.boardId).catch(() => null) : null,
  ]);
  const setup: BoardSetupText = {};
  if (settings) {
    setup.repos = settings.repos;
    setup.defaultRepo = settings.defaultRepo;
    setup.prompt = settings.kickoffPrompt ?? "";
  }
  if (config) setup.cardTypes = config.cardTypes;
  return setup;
}
