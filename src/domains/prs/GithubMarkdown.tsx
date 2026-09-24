import { openUrl } from "@tauri-apps/plugin-opener";
import type { Element, ElementContent } from "hast";
import type { MouseEvent } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "@/components/MermaidDiagram";

// PR comments rendered the way github.com does. Bots (coverage, AI reviewers,
// preview deploys) write markdown mixed with HTML — headings, <details>
// dropdowns, <picture> badges, tables — so raw HTML is parsed (rehype-raw) and
// then cut down to GitHub's own allow-list (rehype-sanitize's default schema
// mirrors github.com's sanitizer). The comment is untrusted input and the app
// has no CSP, so the sanitize step is what keeps scripts, handlers, iframes and
// styles out — it must stay AFTER rehype-raw.

const schema = {
  ...defaultSchema,
  // GitHub also lets <picture>/<source> through (bots theme their badges with them).
  tagNames: [...(defaultSchema.tagNames ?? []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    source: ["srcSet", "media", "type"],
  },
};

const rehypePlugins: Options["rehypePlugins"] = [rehypeRaw, [rehypeSanitize, schema]];
const remarkPlugins = [remarkGfm];

/** Text of a hast subtree (a fenced block's source). */
function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

/** The ```mermaid source inside a <pre>, if that's what it holds. */
function mermaidSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((c): c is Element => c.type === "element");
  const cls = code?.properties?.className;
  const isMermaid = Array.isArray(cls) && cls.includes("language-mermaid");
  return code && isMermaid ? textOf(code).trimEnd() : null;
}

const components: Components = {
  // Links open in the system browser, never inside the webview.
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
  pre: ({ node, children }) => {
    const source = mermaidSource(node);
    return source !== null ? <MermaidDiagram source={source} /> : <pre>{children}</pre>;
  },
  // Badges and screenshots: lazy, never wider than the rail, and gone if the
  // URL needs a GitHub login (private-repo attachments) rather than a broken icon.
  img: ({ src, alt }) =>
    typeof src === "string" && /^https?:\/\//.test(src) ? (
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    ) : null,
};

export function GithubMarkdown({ text }: { text: string }) {
  return (
    <div className="md gh-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
