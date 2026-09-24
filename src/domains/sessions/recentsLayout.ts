import { useEffect } from "react";
import { create } from "zustand";
import { usePersistedFlag } from "@/hooks/usePersistedFlag";

// Whether the Recents column is open. Two inputs: the user's persisted choice,
// and a session detail showing its PR rail — with both side columns open the
// terminal gets barely half the window, so Recents steps aside to a strip while
// a PR rail is up. Expanding it then is a "peek" that lasts until the PR rail
// goes away; the persisted choice is left alone.

const RECENTS_OPEN_KEY = "trace.recentsOpen";

interface RecentsLayout {
  /** A session detail is showing its PR rail. */
  prRailShowing: boolean;
  /** The user expanded Recents despite the PR rail. */
  peek: boolean;
}

const useLayout = create<RecentsLayout>(() => ({ prRailShowing: false, peek: false }));

/** Called by the session detail: report whether its PR rail is on screen. */
export function useReportPrRail(showing: boolean): void {
  useEffect(() => {
    useLayout.setState({ prRailShowing: showing, peek: false });
    return () => useLayout.setState({ prRailShowing: false, peek: false });
  }, [showing]);
}

/** Whether Recents is collapsed to its strip, and how to flip it. */
export function useRecentsCollapsed(): [boolean, () => void] {
  const [open, toggleOpen] = usePersistedFlag(RECENTS_OPEN_KEY, true);
  const { prRailShowing, peek } = useLayout();
  const collapsed = !open || (prRailShowing && !peek);
  const toggle = () => {
    // Beside a PR rail, expanding/collapsing is a temporary peek; the saved
    // preference only changes when it's what's hiding the column.
    if (prRailShowing && open) useLayout.setState({ peek: !peek });
    else {
      toggleOpen();
      if (prRailShowing) useLayout.setState({ peek: true });
    }
  };
  return [collapsed, toggle];
}
