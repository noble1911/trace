import { useEffect } from "react";
import { onActivityEvent } from "@/ipc/events";
import { useActivityStore } from "../store";

/** Load the activity log and keep it live. Mount once, at the app shell. */
export function useActivityFeed(): void {
  useEffect(() => {
    const { hydrate, receive } = useActivityStore.getState();
    void hydrate();
    // A late-resolving registration unlistens immediately (see App.tsx's
    // doubled-listener note).
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onActivityEvent(receive).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
