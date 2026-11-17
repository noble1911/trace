import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./markdown/CodeBlock";
import { CopyableTable } from "./markdown/CopyableTable";
import { fenceLanguage, type HastNode, textOfNode } from "./markdown/highlight";
import { splitInsights } from "./markdown/insight";

// The one Markdown renderer: react-markdown + remark-gfm, so GitHub-Flavored
// extensions — tables, task lists, strikethrough, autolinks — render the way
// GitHub shows them, fenced code is highlighted (markdown/CodeBlock), and a
// table has a copy control for docs and spreadsheets (markdown/CopyableTable).
// Raw HTML is NOT enabled (no rehype-raw), so there is no HTML injection
// surface; output is plain semantic elements styled by the `.md` scope in
// styles/markdown.css. `prose` adds the Chat & transcript settings (agent
// output); without it, the fixed look of docs and release notes.
//
// Streaming text needs nothing special: an unclosed fence runs to the end of
// the text (CommonMark), so a half-written block shows as code, not as a
// stray "```", and becomes the same block when its closing fence lands.
//
// Agent prose also draws Claude Code's "★ Insight" asides (its explanatory
// output style) as callout cards (markdown/insight.ts).

/** Open a link in the system browser, never by navigating the webview. */
export function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      className="md-link"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        if (href && /^(https?:|mailto:)/.test(href)) void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

/** The `pre` of a fenced block, as a highlighted CodeBlock. */
function FencedCode({ node }: { node?: HastNode }) {
  const code = node?.children?.find((c) => c.type === "element");
  const text = textOfNode(code ?? node).replace(/\n$/, "");
  return <CodeBlock code={text} lang={fenceLanguage(code?.properties?.className)} />;
}

export const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => <ExternalLink href={href}>{children}</ExternalLink>,
  pre: ({ node }) => <FencedCode node={node} />,
  table: ({ node, children }) => <CopyableTable node={node}>{children}</CopyableTable>,
};

/** For text inside a button, where a link would be a control inside a control. */
export const NO_LINK_COMPONENTS: Components = {
  a: ({ children }) => <span className="md-link-text">{children}</span>,
};

/** Inline-only Markdown (a plan step, a question): blocks unwrap to their text. */
const INLINE = ["strong", "em", "del", "code", "a", "br"];
const remarkPlugins = [remarkGfm];

interface MarkdownProps {
  text: string;
  /** Agent output: follows Settings → Appearance → Chat & transcript. */
  prose?: boolean;
  /** Render as a span of inline formatting only. */
  inline?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
  /** Overrides on top of MARKDOWN_COMPONENTS (e.g. the chat's file links). */
  components?: Components;
  /** Which URLs survive (react-markdown's default drops `file:`, which the chat's images keep). */
  urlTransform?: UrlTransform;
}

export function Markdown({
  text,
  prose = false,
  inline = false,
  className,
  components = MARKDOWN_COMPONENTS,
  urlTransform,
}: MarkdownProps) {
  const cls = ["md", prose && "prose", inline && "md-inline", className].filter(Boolean).join(" ");
  const render = (markdown: string) => (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={components}
      urlTransform={urlTransform}
      allowedElements={inline ? INLINE : undefined}
      unwrapDisallowed={inline}
    >
      {markdown}
    </ReactMarkdown>
  );
  if (inline) return <span className={cls}>{render(text)}</span>;
  const segments = prose ? splitInsights(text) : [];
  if (segments.length < 2 && segments[0]?.kind !== "insight") {
    return <div className={cls}>{render(text)}</div>;
  }
  return (
    <div className={cls}>
      {segments.map((s, i) =>
        s.kind === "insight" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one text, in order
          <aside key={i} className="md-insight" aria-label="Insight">
            <div className="md-insight-label">Insight</div>
            {render(s.text)}
          </aside>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one text, in order
          <Fragment key={i}>{render(s.text)}</Fragment>
        )
      )}
    </div>
  );
}
