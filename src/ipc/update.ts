import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

// App self-update: check the GitHub release feed and install in place.

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  notes: string | null;
  date: string | null;
}

/** A published release, for the About tab's changelog. */
export interface Release {
  /** Without its `v`: "0.16.1". */
  version: string;
  /** Markdown; empty when the release has none. */
  notes: string;
  publishedAt: string | null;
  url: string | null;
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

/** Every published release, newest first (the update feed has only the newest's notes). */
export function listReleases(): Promise<Release[]> {
  return invoke("list_releases");
}
