import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown renderer for trusted content (release notes, and ADRs / docs in the
// Files tab). Uses react-markdown + remark-gfm so GitHub-Flavored extensions —
// tables, task lists, strikethrough, autolinks — render the same way GitHub
// shows them. Raw HTML is NOT enabled (no rehype-raw), so there is no HTML
// injection surface; output is plain semantic elements styled by the `.md` CSS
// scope in globals.css.

// Links open in the system browser instead of navigating the Tauri webview.
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="md-link"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        if (href && /^https?:\/\//.test(href)) void openUrl(href);
      }}
    >
      {children}
    </a>
  ),
};

const remarkPlugins = [remarkGfm];

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
