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

/** Where an install applies, in Claude Code's words (`other`: one trace doesn't install into). */
export type InstallScope = "user" | "project" | "local" | "other";

/** One install, as Claude Code reports it. */
export interface Installed {
  /** `<plugin>@<marketplace>`. */
  id: string;
  version: string | null;
  scope: InstallScope;
  enabled: boolean;
  projectPath: string | null;
}

/** One of trace's repositories and its plugins. */
export interface ProjectInstalls {
  repo: string;
  /** In its main checkout: for everyone (`project`) or just you (`local`). */
  installed: Installed[];
  /** Plugin ids its default branch enables for everyone: they come with the repo. */
  committed: string[];
}

export interface Installs {
  /** Everywhere, just for you. */
  user: Installed[];
  projects: ProjectInstalls[];
}

/** What's installed, for you and in each of trace's repositories (asks Claude Code). */
export function skillInstalls(): Promise<Installs> {
  return invoke("skills_installs");
}

/**
 * Install `plugin` from added source `source` (`owner/name`) for `scope`; a project's
 * scopes name one of trace's repositories. Resolves with Claude Code's message.
 */
export function installPlugin(
  source: string,
  plugin: string,
  scope: InstallScope,
  repo: string | null
): Promise<string> {
  return invoke("skills_install", { source, plugin, scope, repo });
}

/** Remove plugin `id` (`<plugin>@<marketplace>`) from `scope`. */
export function uninstallPlugin(
  id: string,
  scope: InstallScope,
  repo: string | null
): Promise<string> {
  return invoke("skills_uninstall", { id, scope, repo });
}

/** Bring plugin `id` in `scope` up to its marketplace's latest. */
export function updatePlugin(
  id: string,
  scope: InstallScope,
  repo: string | null
): Promise<string> {
  return invoke("skills_update", { id, scope, repo });
}
