/** Canonical `https://github.com/o/r/pull/N` for a PR-ish URL; null if it isn't one. */
export function canonicalPrUrl(url: string): string | null {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}
