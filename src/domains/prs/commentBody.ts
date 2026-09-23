// Bot comments (coverage, preview deploys, AI reviewers) are mostly HTML
// scaffolding and badge images. The shared Markdown renderer drops raw HTML
// (safely), but images would still load remote badges into the rail. This keeps
// the words and the links, and drops the chrome.

/** Canonical `https://github.com/o/r/pull/N` for a PR-ish URL; null if it isn't one. */
export function canonicalPrUrl(url: string): string | null {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}

/** Markdown fit for the rail: no comments, images, or runs of blank lines. */
export function tidyBody(body: string): string {
  return (
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<img\b[^>]*>/gi, "")
      // [![badge](img)](link) → nothing; ![alt](img) → alt
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?(details|summary|sub|sup|p|div|br|hr)\b[^>]*>/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
