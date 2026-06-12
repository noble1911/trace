import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

// Minimal markdown renderer for simple trusted content (release notes):
// headings, bullet lists, paragraphs, **bold**, *italic*, `code`, [links].
// Builds React elements directly — no HTML injection surface, no dependency.
// Anything outside the subset renders as plain text, never breaks.

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}.${i++}`;
    if (m[1]) {
      out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    } else if (m[2]) {
      out.push(<strong key={key}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{m[3].slice(1, -1)}</em>);
    } else if (m[4] && m[5]) {
      const url = m[5];
      out.push(
        <button
          type="button"
          className="md-link"
          key={key}
          onClick={() => {
            if (/^https?:\/\//.test(url)) void openUrl(url);
          }}
        >
          {m[4]}
        </button>
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let pending: string[] = [];
  let key = 0;

  const flushList = () => {
    if (pending.length === 0) return;
    const items: ReactNode[] = [];
    for (const item of pending) {
      key++;
      items.push(<li key={`li-${key}`}>{inline(item, `li-${key}`)}</li>);
    }
    pending = [];
    key++;
    blocks.push(<ul key={`ul-${key}`}>{items}</ul>);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      pending.push(bullet[1]);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    key++;
    if (heading) {
      blocks.push(
        <div key={`h-${key}`} className={`md-h md-h${heading[1].length}`}>
          {inline(heading[2], `h-${key}`)}
        </div>
      );
    } else {
      blocks.push(<p key={`p-${key}`}>{inline(line, `p-${key}`)}</p>);
    }
  }
  flushList();

  return <div className="md">{blocks}</div>;
}
