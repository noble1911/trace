import { memo, type ReactNode } from "react";
import { type Components, defaultUrlTransform } from "react-markdown";
import { ExternalLink, MARKDOWN_COMPONENTS, Markdown } from "@/components/Markdown";
import { FileLink } from "@/domains/transcript/FileLink";
import { ChatImage } from "./ChatImage";
import { resolvePath, useChatView } from "./chatContext";
import { keepLocalImages } from "./imagePath";

// An agent's Markdown, as the shared `<Markdown>` renders it (GFM, highlighted
// fences, no raw HTML, the Chat & transcript style), plus file links: an
// inline code span or a link that names a file (`src/a.ts`, `src/a.ts:42`)
// becomes the transcript's FileLink, which opens it in an editor or copies
// its path. An image (`![Preview](/path/a.png)`) is a ChatImage, which loads a
// local file through `trace-img`. The transcript view uses it too, under its own
// ChatViewContext.

/** A path with a directory and an extension, optionally `:line` or `:line:col`. */
const FILE_REF = /^(?:[a-zA-Z]:)?[\w.@~-]*[\\/][\w./\\@~ -]*\.[\w]{1,8}(?::\d+(?:[:-]\d+)?)?$/;

/** The path part of a file reference, or null when `text` isn't one. */
export function fileRef(text: string): string | null {
  const t = text.trim();
  if (!FILE_REF.test(t) || /^https?:/.test(t)) return null;
  return t.replace(/:\d+(?:[:-]\d+)?$/, "");
}

function textOf(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

function InlineFile({ text }: { text: string }) {
  const { workspaceId, root } = useChatView();
  const path = fileRef(text);
  if (!path) return <code>{text}</code>;
  return <FileLink workspaceId={workspaceId} path={resolvePath(path, root)} root={root} />;
}

const components: Components = {
  ...MARKDOWN_COMPONENTS,
  // A file link's menu is a block element, which a <p> can't hold.
  p: ({ children }) => <div className="ac-p">{children}</div>,
  a: ({ href, children }) => {
    const target = href && !/^[a-z]+:/i.test(href) ? fileRef(href) : null;
    if (target) return <InlineFile text={href ?? ""} />;
    return <ExternalLink href={href}>{children}</ExternalLink>;
  },
  // Fenced blocks go through `pre` (a CodeBlock), so this is only inline code.
  code: ({ children }) => <InlineFile text={textOf(children)} />,
  img: ({ src, alt }) => <ChatImage src={typeof src === "string" ? src : undefined} alt={alt} />,
};

/** The default URL filter, except an image keeps a `file:` URL or a drive path. */
const urlTransform = keepLocalImages(defaultUrlTransform);

interface ChatMarkdownProps {
  text: string;
  /** Inline formatting only, for a line inside a card (a plan step, a question). */
  inline?: boolean;
}

/** Parsing is the costly part of a render; text that hasn't changed isn't re-parsed. */
export const ChatMarkdown = memo(function ChatMarkdown({ text, inline }: ChatMarkdownProps) {
  return (
    <Markdown
      text={text}
      prose
      inline={inline}
      className="ac-md"
      components={components}
      urlTransform={urlTransform}
    />
  );
});
