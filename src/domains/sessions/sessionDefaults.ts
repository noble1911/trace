import { peerIdOf } from "@/domains/peers/hostChoices";
import type { Transport } from "@/ipc/agent";
import type { SessionHostId } from "./types";

// What the New session dialog opens with: the choices it was last started with, so
// starting another session in the same repo is one keystroke. Settings-level defaults
// (the CLI and provider) stay in `domains/agent/defaults` — those are shared with the
// board and belong to Settings, not to this dialog.
//
// Stored like the agent defaults: localStorage, a missing key reading as "not chosen",
// and nothing written for an empty value.

const PLACE_KEY = "trace.newSession.place";
const FOLDER_KEY = "trace.newSession.folder";
const HOST_KEY = "trace.newSession.host";
const TRANSPORT_KEY = "trace.newSession.transport";
const MODEL_KEY = "trace.newSession.model";
const MODE_KEY = "trace.newSession.mode";

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable in sandboxed contexts — the dialog still
    // works, it just opens on its own defaults next time.
  }
}

/** The dialog's last choices. Each is null when it has never been chosen. */
export interface SessionStart {
  /** A repo's path, or the dialog's own "scratch" / "folder" value. */
  place: string | null;
  folder: string | null;
  host: SessionHostId | null;
  transport: Transport | null;
  model: string | null;
  mode: string | null;
}

/** Vercel or a peer id; anything else reads as this computer. */
function savedHost(saved: string): SessionHostId | null {
  return saved === "vercel" || peerIdOf(saved) ? (saved as SessionHostId) : null;
}

export function lastSessionStart(): SessionStart {
  const transport = read(TRANSPORT_KEY);
  return {
    place: read(PLACE_KEY) || null,
    folder: read(FOLDER_KEY) || null,
    host: savedHost(read(HOST_KEY)),
    transport: transport === "chat" || transport === "terminal" ? transport : null,
    model: read(MODEL_KEY) || null,
    mode: read(MODE_KEY) || null,
  };
}

export function rememberSessionStart(next: SessionStart) {
  write(PLACE_KEY, next.place ?? "");
  write(FOLDER_KEY, next.folder ?? "");
  write(HOST_KEY, next.host ?? "");
  write(TRANSPORT_KEY, next.transport ?? "");
  write(MODEL_KEY, next.model ?? "");
  write(MODE_KEY, next.mode ?? "");
}
