// The print copy's last resort, for when the sanitised copy can't be rendered
// (the sanitiser threw, or the webview can't style a shadow root). The document
// is not trusted there, so it is never handed to the frame as HTML: only its
// text is, escaped, under a policy that loads nothing. No DOM, so it is tested
// under `npm test`.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The readable text of `html`: scripts, styles and markup dropped, common entities decoded. */
export function plainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|head|template|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|pre|section|article|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*(?:>|$)/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : m;
      }
      return ENTITIES[name.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A frame document that shows `html`'s text and can fetch nothing. */
export function fallbackSrcDoc(html: string): string {
  return (
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<body style="margin:0;font:14px/1.5 sans-serif;white-space:pre-wrap">${escapeText(plainText(html))}</body>`
  );
}
