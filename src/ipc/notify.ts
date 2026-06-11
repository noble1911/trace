import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Native notifications + Dock badge. Permission is requested lazily on the
// first notification; a denial just makes notify() a silent no-op.

export async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    // Notifications are best-effort — never let them break the caller.
  }
}

/** Show `count` on the Dock icon; 0 clears it. */
export function setDockBadge(count: number): void {
  void getCurrentWindow()
    .setBadgeCount(count > 0 ? count : undefined)
    .catch(() => {});
}
