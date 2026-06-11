import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

// App self-update: check the GitHub release feed and install in place.

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  notes: string | null;
  date: string | null;
}

/** The running app's version (from tauri.conf.json at build time). */
export function appVersion(): Promise<string> {
  return getVersion();
}

/** A newer release, or null when up to date. */
export function checkAppUpdate(): Promise<UpdateInfo | null> {
  return invoke("check_app_update");
}

/** Download, verify, install, and restart into the new build. */
export function installAppUpdate(): Promise<void> {
  return invoke("install_app_update");
}
