import { useState } from "react";

const KEY = "trace.sessionsTab";

function load(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The Sessions page tab the user was last on, remembered across visits and
 * launches. A remembered tab that no longer exists reads as the default tab
 * (`null`) — but isn't forgotten until the user picks another, so the moment
 * before the tabs have loaded can't wipe it.
 */
export function useLastTab(tabIds: string[]): [string | null, (tab: string | null) => void] {
  const [stored, setStored] = useState<string | null>(load);
  const choose = (tab: string | null) => {
    try {
      if (tab === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, tab);
    } catch {
      // best-effort: the choice still applies for this visit
    }
    setStored(tab);
  };
  return [stored !== null && tabIds.includes(stored) ? stored : null, choose];
}
