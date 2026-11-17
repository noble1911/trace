import { invoke } from "@tauri-apps/api/core";

// Skill sources (`commands/skills.rs`): GitHub repos of Claude Code skills the user
// added, and what each holds. Read over GitHub with trace's own token; the token stays
// on the Rust side. See docs/SKILLS_PLAN.md.

/** A plugin marketplace (`.claude-plugin/marketplace.json`) or plain `SKILL.md` folders. */
export type SourceKind = "marketplace" | "folders";

export interface SourceRecord {
  /** `owner/name`. */
  repo: string;
  /** Epoch ms. */
  addedAt: number;
  autoUpdate: boolean;
}

export interface Skill {
  /** Its frontmatter `name`, else its folder's. */
  name: string;
  description: string | null;
  /** Its folder in the repo. */
  folder: string;
  /** Changes when anything in the folder does. */
  folderSha: string;
}

export interface Plugin {
  name: string;
  description: string | null;
  version: string | null;
  /** Its folder in the repo; null when it lives in another repo. */
  folder: string | null;
  /** Empty for a plugin from another repo: Claude Code fetches those on install. */
  skills: Skill[];
}

export interface SourceView {
  repo: string;
  url: string;
  description: string | null;
  kind: SourceKind;
  /** A marketplace's own name: its plugins are `<plugin>@<this>`. */
  marketplace: string | null;
  plugins: Plugin[];
  skills: Skill[];
  /** More skills than trace lists. */
  truncated: boolean;
}

export function skillSources(): Promise<SourceRecord[]> {
  return invoke("skills_sources");
}

export function readSkillSource(repo: string): Promise<SourceView> {
  return invoke("skills_read_source", { repo });
}

/** Read `repo` and add it if it holds skills; rejects with why not. */
export function addSkillSource(
  repo: string
): Promise<{ sources: SourceRecord[]; source: SourceView }> {
  return invoke("skills_add_source", { repo });
}

export function removeSkillSource(repo: string): Promise<SourceRecord[]> {
  return invoke("skills_remove_source", { repo });
}
