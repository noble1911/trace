import type { OutputChunk } from "@/domains/board/store";

// Turning raw PTY scrollback into readable text. The board store keeps each
// workspace's output as base64 chunks (ANSI + multibyte preserved); search and
// the orchestrator both need the words back out, so the decode lives here once.

/** Decode one base64 PTY chunk to its UTF-8 text. */
export function decodePtyChunk(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// CSI sequences, OSC sequences (incl. hyperlinks), and stray control chars —
// the screen-painting noise between the words.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences is this regex's entire job
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f]/g;

/** Strip ANSI escape/control sequences, leaving readable text. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * Decode + strip a run of PTY chunks into plain text, keeping the last
 * `maxChars` — the readable tail is what matters for a transcript snapshot.
 */
export function transcriptText(chunks: OutputChunk[], maxChars = 12_000): string {
  let text = "";
  for (const c of chunks) {
    try {
      text += stripAnsi(decodePtyChunk(c.data));
    } catch {
      // Skip an undecodable chunk rather than losing the rest.
    }
  }
  return text.length > maxChars ? text.slice(-maxChars) : text;
}
