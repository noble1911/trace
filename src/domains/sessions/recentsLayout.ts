import { usePersistedFlag } from "@/hooks/usePersistedFlag";

// Whether the Recents column is collapsed to its strip. Only the user's own
// toggle decides it: it used to also step aside while a session's PR panel was
// open, which meant closing the PR panel popped Recents back open — each
// panel's button now changes that panel and nothing else.

const RECENTS_OPEN_KEY = "trace.recentsOpen";

/** Whether Recents is collapsed, and how to flip it. Shared by the shell and the column. */
export function useRecentsCollapsed(): [boolean, () => void] {
  const [open, toggle] = usePersistedFlag(RECENTS_OPEN_KEY, true);
  return [!open, toggle];
}
