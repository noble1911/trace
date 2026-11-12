import { trackerForIssueKey } from "./types.ts";

// The stored Jira site may carry a protocol (even a malformed `https//`) and/or
// a path — reduce it to a bare host so links are always well-formed.
function hostOf(site: string): string {
  return site
    .trim()
    .replace(/^https?:?\/\/?/i, "")
    .replace(/\/.*$/, "");
}

/** A Jira browse URL for an issue/epic key, or undefined without a site. */
export function jiraBrowseUrl(site: string | null | undefined, key: string): string | undefined {
  if (!site) return undefined;
  return `https://${hostOf(site)}/browse/${key}`;
}

/** Where an issue opens in its tracker: the URL the provider gave it (Pylon's `link`), else
 * Jira's browse URL. A custom-board card has no page outside trace, so it gets none. */
export function issueBrowseUrl(
  issue: { key: string; browseUrl?: string | null },
  site: string | null | undefined
): string | undefined {
  if (issue.browseUrl) return issue.browseUrl;
  return trackerForIssueKey(issue.key) === "jira" ? jiraBrowseUrl(site, issue.key) : undefined;
}
