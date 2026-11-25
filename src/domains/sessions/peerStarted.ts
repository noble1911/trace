import { openWorkspace } from "@/app/openWorkspace";
import { pageNav } from "@/app/pageNav";
import { toast } from "@/app/toast";
import { adoptIfAlive } from "@/domains/board/adopt";
import { creatorLabel, creatorOf } from "./createdBy";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

// A session another computer started on this one, over the peer server. The backend
// made and started it without this window, so it's listed here, its live PTY is taken
// into the running set (it would otherwise offer Start over an agent that's already
// going), and a notice says where it came from. It's an ordinary session from then
// on: open it to watch or type, or Start it again here once the other computer stops.

/** List a session the peer server made, adopt its agent if it's running, and say so. */
export function notePeerSession(session: ScratchSession): void {
  useSessionsStore.getState().adopt(session);
  void adoptIfAlive(session.id).catch(() => {});
  const from = creatorLabel(creatorOf(session));
  toast.notice(`${from} started “${session.title}” on this computer.`, {
    action: { label: "Open", run: () => openWorkspace(session.id, pageNav() ?? (() => {})) },
  });
}
