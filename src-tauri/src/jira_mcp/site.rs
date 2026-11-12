//! Which Jira site the board reads. One Atlassian login can reach several
//! sites; every tool call names one by its `cloudId`. The site chosen at
//! connect is saved (`issues::mcp_link`) and used from then on.

use serde_json::Value;

use super::parse::{id_of, items, text};

/// A Jira site the login can reach.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    /// The cloudId every tool call names.
    pub id: String,
    pub name: String,
    /// `https://your-org.atlassian.net`.
    pub url: String,
}

/// The Jira sites in `getAccessibleAtlassianResources`. A site is listed
/// once per product (Jira's scopes, Confluence's), so they're merged by id;
/// one whose entries carry scopes but none of Jira's is left out.
pub fn sites(v: &Value) -> Vec<Site> {
    let entries = items(v, &["resources", "sites", "values"]);
    let mut out: Vec<Site> = Vec::new();
    for e in entries {
        let Some(id) = id_of(e.get("id").or_else(|| e.get("cloudId"))) else {
            continue;
        };
        if out.iter().any(|s| s.id == id) {
            continue;
        }
        let jira = |e: &Value| {
            e.get("scopes")
                .and_then(Value::as_array)
                .is_none_or(|scopes| {
                    scopes
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|s| s.contains("jira"))
                })
        };
        let same: Vec<&Value> = entries
            .iter()
            .filter(|o| id_of(o.get("id").or_else(|| o.get("cloudId"))).as_ref() == Some(&id))
            .collect();
        if !same.iter().any(|o| jira(o)) {
            continue;
        }
        let url = text(e, &["url", "siteUrl"]).unwrap_or_default().to_string();
        let name = text(e, &["name", "displayName"]).map_or_else(|| url.clone(), str::to_string);
        out.push(Site { id, name, url });
    }
    out
}

/// The site to use: `wanted` (a saved or chosen cloudId) when the login
/// still reaches it, else the only one there is. Err lists the choices.
pub fn choose(sites: Vec<Site>, wanted: Option<&str>) -> Result<Site, Vec<Site>> {
    if let Some(site) = wanted.and_then(|w| sites.iter().find(|s| s.id == w)) {
        return Ok(site.clone());
    }
    match sites.as_slice() {
        [only] => Ok(only.clone()),
        _ => Err(sites),
    }
}

impl Site {
    /// The bare host (`your-org.atlassian.net`): what the frontend builds
    /// browse links from, as it does with the REST connection's site.
    pub fn host(&self) -> String {
        let bare = self
            .url
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        bare.split('/').next().unwrap_or(bare).to_string()
    }
}
