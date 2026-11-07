import type { ProviderKind } from "@/domains/issues/types";
import { TRACKER_NAMES } from "@/domains/sidebar/items";
import { NAV_LABELS, type NavId } from "./nav";
import { RAIL_ICONS } from "./railIcons";

interface TrackerMissingProps {
  nav: NavId;
  tracker: ProviderKind;
  onNav: (nav: NavId) => void;
}

// A tracker's page the user keeps on the rail (Settings → Sidebar) while that tracker
// isn't connected: say what would fill it, and where to connect it.
export function TrackerMissing({ nav, tracker, onNav }: TrackerMissingProps) {
  const Icon = RAIL_ICONS[nav];
  const name = TRACKER_NAMES[tracker];
  const page = NAV_LABELS[nav].replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="empty-state">
      <div className="inner">
        <span className="ic">
          <Icon size={28} />
        </span>
        <div className="title">{name} isn't connected</div>
        <div className="hint">
          {page} shows data from {name}. Connect it in Integrations, or hide this page in Settings →
          Sidebar.
        </div>
        <button type="button" className="btn" onClick={() => onNav("integrations")}>
          Open Integrations
        </button>
      </div>
    </div>
  );
}
