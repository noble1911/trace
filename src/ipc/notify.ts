import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Native notifications + Dock badge. Permission is requested lazily on the
// first notification; a denial just makes notify() a silent no-op.

// Desktop notification plugins DON'T deliver click callbacks — the plugin's
// `onAction`/`actionPerformed` event is emitted only on iOS/Android; on macOS
// it just shows the notification and never reports the click. So we approximate
// "the user clicked the notification" with "the app regained focus shortly
// after one was shown" — clicking a macOS notification activates the app, which
// fires the webview focus event. `notify()` records the target; the focus
// handler in App.tsx consumes it. (Note: in `tauri dev` macOS attributes the
// notification to Terminal, so clicking focuses Terminal, not trace — this only
// works in a packaged build.)
let pendingClick: { workspaceId: string; at: number } | null = null;
const CLICK_WINDOW_MS = 30_000;

export async function notify(title: string, body: string, workspaceId?: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    if (workspaceId) pendingClick = { workspaceId, at: Date.now() };
    sendNotification({ title, body });
  } catch {
    // Notifications are best-effort — never let them break the caller.
  }
}

/**
 * The workspace whose notification the user most likely just clicked, or null.
 * "Likely clicked" = a notification was shown within the last few seconds and
 * the app just regained focus. Consumes the pending target either way, so a
 * later unrelated focus doesn't re-trigger navigation.
 */
export function consumeNotificationClick(): string | null {
  const p = pendingClick;
  pendingClick = null;
  return p && Date.now() - p.at < CLICK_WINDOW_MS ? p.workspaceId : null;
}

/** Show `count` on the Dock icon; 0 clears it. */
export function setDockBadge(count: number): void {
  void getCurrentWindow()
    .setBadgeCount(count > 0 ? count : undefined)
    .catch(() => {});
}
