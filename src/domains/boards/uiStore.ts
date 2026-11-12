import { create } from "zustand";

// Which custom-board dialog or prompt is open. They're asked for from places that
// don't draw them (the topbar's switcher, a card's menu), so the ask lives here.

/** The board-name dialog: making a board, or renaming one. */
export type NameDialog = { mode: "new" } | { mode: "rename"; boardId: string; name: string };

interface BoardsUiStore {
  nameDialog: NameDialog | null;
  /** The card whose edit dialog is open (from its menu). */
  editingCard: string | null;
  /** The card whose delete prompt is armed (from its menu). */
  deletingCard: string | null;
  openNameDialog: (dialog: NameDialog) => void;
  closeNameDialog: () => void;
  editCard: (key: string | null) => void;
  confirmDeleteCard: (key: string | null) => void;
}

export const useBoardsUi = create<BoardsUiStore>((set) => ({
  nameDialog: null,
  editingCard: null,
  deletingCard: null,
  openNameDialog: (nameDialog) => set({ nameDialog }),
  closeNameDialog: () => set({ nameDialog: null }),
  editCard: (editingCard) => set({ editingCard }),
  confirmDeleteCard: (deletingCard) => set({ deletingCard }),
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
