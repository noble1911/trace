// The stored Jira site may carry a protocol (even a malformed `https//`) and/or
// a path — reduce it to a bare host so links are always well-formed.
function hostOf(site: string): string {
  return site
    .trim()
    .replace(/^https?:?\/\/?/i, "")
    .replace(/\/.*$/, "");
}

/** A Jira browse URL for an issue/epic key, or undefined without a site. */
export function browseUrl(site: string | null | undefined, key: string): string | undefined {
  if (!site) return undefined;
  return `https://${hostOf(site)}/browse/${key}`;
}
