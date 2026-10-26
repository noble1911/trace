import { SidePanel } from "@/components/SidePanel";
import { type PanelPlace, useSidePanel } from "@/components/useSidePanel";
import { OrchestratorPane } from "@/domains/orchestrator/OrchestratorPane";

const VIEWS = ["orchestrator"];

/**
 * A page's right-edge panel (Board, Sessions): the orchestrator, folded to its
 * strip until opened (⌘J). A ticket or session open over the page brings its
 * own panel, which then takes ⌘J.
 */
export function PagePanel({ place }: { place: PanelPlace }) {
  const panel = useSidePanel(place, VIEWS);
  return (
    <SidePanel
      views={[{ id: "orchestrator", label: "Orchestrator", content: <OrchestratorPane /> }]}
      active={panel.view}
      open={panel.open}
      onShow={panel.show}
      onClose={panel.close}
    />
  );
}
