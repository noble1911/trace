import type { IssueComment } from "@/domains/issues/types";

const MAX_COMMENTS_CHARS = 3000;

/** Format the issue's thread as a compact transcript, keeping the newest
 * messages when the cap forces a cut (the brief's value is recent context). */
export function formatComments(comments: IssueComment[]): string {
  if (comments.length === 0) return "(no comments yet)";
  const lines = comments.map((c) => {
    const when = c.created ? `${c.created.slice(0, 16).replace("T", " ")} ` : "";
    const tag = c.isInternal ? " [internal]" : "";
    return `— ${when}${c.author}${tag}: ${c.body}`;
  });
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > MAX_COMMENTS_CHARS) break;
    kept.unshift(lines[i]);
  }
  if (kept.length === 0) {
    // A single message bigger than the cap — keep its tail rather than nothing.
    return `…(truncated)\n${lines[lines.length - 1].slice(-MAX_COMMENTS_CHARS)}`;
  }
  const omitted = lines.length - kept.length;
  const header = omitted > 0 ? `…(${omitted} earlier message(s) omitted)\n` : "";
  return header + kept.join("\n");
}

export interface KickoffValues {
  /** The tracker's name: "Jira", "Pylon". */
  tracker: string;
  key: string;
  summary: string;
  description: string;
  comments: string;
}

/** Fill the template's placeholders in one pass, with a replacer function. Chained
 * string replaces would also rewrite placeholders that appear inside ticket text, and
 * would treat `$&` or `$1` in that text as replacement patterns. */
export function fillKickoffTemplate(template: string, values: KickoffValues): string {
  return template.replace(
    /\{(tracker|key|summary|description|comments)\}/g,
    (_match, name: keyof KickoffValues) => values[name]
  );
}
