import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Native notifications + Dock badge. Permission is requested lazily on the
// first notification; a denial just makes notify() a silent no-op.

// notification id → workspace id, so a click can route to the exact session.
// Notifications don't survive a reload, so an in-memory map is fine; ids are
// 32-bit ints as the plugin requires.
const targets = new Map<number, string>();
let nextId = 1;

export async function notify(title: string, body: string, workspaceId?: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    if (workspaceId) {
      const id = nextId++;
      targets.set(id, workspaceId);
      // Carry the target two ways: `extra` (round-trips on desktop) and the
      // id→map fallback, so the click handler resolves whichever survives.
      sendNotification({ title, body, id, extra: { workspaceId } });
    } else {
      sendNotification({ title, body });
    }
  } catch {
    // Notifications are best-effort — never let them break the caller.
  }
}

/**
 * Route notification clicks to their workspace id. Registered once at startup;
 * fires when the user clicks a notification (the default tap, or an action).
 */
export function onNotificationClick(cb: (workspaceId: string) => void): void {
  void onAction((n) => {
    const fromExtra =
      typeof n.extra?.workspaceId === "string" ? (n.extra.workspaceId as string) : undefined;
    const fromId = typeof n.id === "number" ? targets.get(n.id) : undefined;
    const workspaceId = fromExtra ?? fromId;
    if (workspaceId) cb(workspaceId);
  }).catch(() => {});
}

/** Bring the app window to the front (e.g. after a notification click). */
export function focusWindow(): void {
  const win = getCurrentWindow();
  void win.unminimize().catch(() => {});
  void win.setFocus().catch(() => {});
}

/** Show `count` on the Dock icon; 0 clears it. */
export function setDockBadge(count: number): void {
  void getCurrentWindow()
    .setBadgeCount(count > 0 ? count : undefined)
    .catch(() => {});
}
