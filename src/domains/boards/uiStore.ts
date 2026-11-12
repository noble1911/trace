import { create } from "zustand";
import { useBoardStore } from "@/domains/board/store";
import type { BoardSettings } from "@/ipc/boardSettings";

// Which custom-board dialog or prompt is open. They're asked for from places that
// don't draw them (the topbar's switcher, a card's menu), so the ask lives here.

/** The board dialogs: making a board (`NewBoardModal`), or renaming one. */
export type NameDialog = { mode: "new" } | { mode: "rename"; boardId: string; name: string };

/** A board's settings dialog: which board, and what to fill it with instead of what's
 * saved (a new board whose settings didn't save). */
export interface SettingsDialog {
  boardKey: string;
  draft?: BoardSettings;
}

interface BoardsUiStore {
  nameDialog: NameDialog | null;
  /** The card whose edit dialog is open (from its menu). */
  editingCard: string | null;
  /** The card whose delete prompt is armed (from its menu). */
  deletingCard: string | null;
  /** The board whose settings dialog is open: any tracker's, or custom. */
  settingsFor: SettingsDialog | null;
  openSettings: (dialog: SettingsDialog | null) => void;
  openNameDialog: (dialog: NameDialog) => void;
  closeNameDialog: () => void;
  editCard: (key: string | null) => void;
  confirmDeleteCard: (key: string | null) => void;
}

export const useBoardsUi = create<BoardsUiStore>((set) => ({
  nameDialog: null,
  editingCard: null,
  deletingCard: null,
  settingsFor: null,
  openSettings: (settingsFor) => set({ settingsFor }),
  openNameDialog: (nameDialog) => set({ nameDialog }),
  closeNameDialog: () => set({ nameDialog: null }),
  editCard: (editingCard) => set({ editingCard }),
  confirmDeleteCard: (deletingCard) => set({ deletingCard }),
}));

// A card's edit dialog and delete prompt belong to the board they were opened on:
// showing another board closes them, so they don't come back on returning to it.
useBoardStore.subscribe((board, prev) => {
  if (board.boardKey === prev.boardKey) return;
  const { editingCard, deletingCard } = useBoardsUi.getState();
  if (editingCard || deletingCard) useBoardsUi.setState({ editingCard: null, deletingCard: null });
});

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
