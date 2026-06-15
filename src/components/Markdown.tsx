import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

// Minimal markdown renderer for trusted content (release notes, and ADRs /
// docs in the Files tab). Builds React elements directly — no HTML injection
// surface, no dependency. Handles headings (h1–h6), unordered + ordered lists,
// fenced code blocks, blockquotes, horizontal rules, paragraphs, and inline
// **bold**, *italic*, `code`, and [links]. Anything outside the subset renders
// as plain text, never breaks.

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
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  // Monotonic per-render key — stable across renders for the same text, and
  // never derived from a list index (which the linter forbids).
  let uid = 0;
  const k = () => `md-${uid++}`;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block — verbatim until the matching fence.
    const fence = trimmed.match(/^(```|~~~)/);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence
      blocks.push(
        <pre key={k()} className="md-code">
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={k()} className="md-hr" />);
      i++;
      continue;
    }

    // Blockquote — consecutive `>` lines, joined.
    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={k()} className="md-quote">
          {inline(quote.join(" "), k())}
        </blockquote>
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const key = k();
        items.push(<li key={key}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""), key)}</li>);
        i++;
      }
      blocks.push(<ul key={k()}>{items}</ul>);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const key = k();
        items.push(<li key={key}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""), key)}</li>);
        i++;
      }
      blocks.push(<ol key={k()}>{items}</ol>);
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    // Heading.
    const heading = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      const key = k();
      blocks.push(
        <div key={key} className={`md-h md-h${heading[1].length}`}>
          {inline(heading[2], key)}
        </div>
      );
      i++;
      continue;
    }

    // Paragraph.
    const key = k();
    blocks.push(<p key={key}>{inline(trimmed, key)}</p>);
    i++;
  }

  return <div className="md">{blocks}</div>;
}
