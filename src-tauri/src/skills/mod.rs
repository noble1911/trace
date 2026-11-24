//! Skill sources: GitHub repos of Claude Code skills the user picked, read so a
//! non-technical user can see what's in them (`docs/SKILLS_PLAN.md`). A source
//! is either a **plugin marketplace** (`.claude-plugin/marketplace.json`; Claude
//! Code installs its plugins) or plain **skill folders** (`…/<name>/SKILL.md`).
//! Nothing is hardcoded: any repo the repo browser lists can be one.
//!
//! Stage 1: adding, reading and removing sources. Reading is over the GitHub REST
//! API with trace's own token (`layout` decides, `source` fetches).
//! Stage 2: installing a marketplace's plugins, through Claude Code's own
//! `claude plugin` CLI (`cli`), for the user or one of trace's repositories
//! (`installs`), with what a repo already commits read from git (`project`).
//! Skill folders (stage 3) are listed but not installed yet.

pub mod cli;
pub mod installs;
pub mod layout;
pub mod project;
pub mod source;
pub mod store;

use serde::Serialize;

pub use layout::PluginEntry;

/// What kind of repo a source is.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// Lists plugins in `.claude-plugin/marketplace.json`.
    Marketplace,
    /// Folders with a `SKILL.md` each.
    Folders,
}

/// One skill, as the source's card shows it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Its frontmatter `name`, else its folder's name.
    pub name: String,
    pub description: Option<String>,
    /// Its folder in the repo.
    pub folder: String,
    /// The folder's git tree SHA: it changes when anything in it does.
    pub folder_sha: String,
}

/// A marketplace's plugin and the skills it carries (none listed when it lives
/// in another repo: Claude Code fetches those on install).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    #[serde(flatten)]
    pub entry: PluginEntry,
    pub skills: Vec<Skill>,
}

/// A source as the Skills tab draws it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    /// `owner/name`.
    pub repo: String,
    pub url: String,
    pub description: Option<String>,
    pub kind: Kind,
    /// A marketplace's own name: Claude Code calls its plugins `<plugin>@<this>`.
    pub marketplace: Option<String>,
    /// A marketplace's plugins.
    pub plugins: Vec<Plugin>,
    /// A folders source's skills.
    pub skills: Vec<Skill>,
    /// More skills than trace lists, or a tree GitHub cut short.
    pub truncated: bool,
}
