import { ConfirmPrompt } from "@/components/InlineConfirm";
import { deleteCard } from "./boardEdits";
import { useBoardsUi } from "./uiStore";

// A custom card's delete, armed from its menu and confirmed at the card's foot
// (trace-ui §5). Clicks stay here, so they don't open the card underneath.
export function CardDeletePrompt({ issueKey }: { issueKey: string }) {
  const disarm = () => useBoardsUi.getState().confirmDeleteCard(null);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps clicks from opening the card
    // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle the keyboard
    <div className="bd-card-delete" onClick={(e) => e.stopPropagation()}>
      <ConfirmPrompt
        size="xs"
        message={`Delete ${issueKey}?`}
        confirmLabel="Delete"
        onCancel={disarm}
        onConfirm={() => {
          disarm();
          void deleteCard(issueKey);
        }}
      />
    </div>
  );
}
