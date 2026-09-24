import { toast } from "@/app/toast";
import type { MenuItem } from "@/components/PopMenu";
import { type Editor, openInEditor } from "@/ipc/editor";

const EDITORS: { id: Editor; label: string }[] = [
  { id: "vscode", label: "VS Code" },
  { id: "intellij", label: "IntelliJ" },
  { id: "cursor", label: "Cursor" },
];

/** "Open in …" menu items for a workspace's worktree (or repo root). */
export function editorItems(workspaceId: string): MenuItem[] {
  return EDITORS.map((ed) => ({
    label: `Open in ${ed.label}`,
    onSelect: () => {
      void openInEditor(workspaceId, ed.id).catch((e) => toast.error(String(e)));
    },
  }));
}
