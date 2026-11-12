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

/// The Jira sites in `getAccessibleAtlassianResources`. v1 lists a site once
/// per product (Jira's scopes, Confluence's), so entries are merged by id; v2
/// lists it once with its products. A site without Jira is left out.
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
        // v2 lists each site's products (`{ id: "jira", access }`); v1 listed a
        // site once per product with that product's scopes. Neither: assume Jira.
        let jira = |e: &Value| {
            if let Some(products) = e.get("products").and_then(Value::as_array) {
                return products
                    .iter()
                    .any(|p| p.get("id").or(Some(p)).and_then(Value::as_str) == Some("jira"));
            }
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
        // v2 gives no name: the host stands in for one.
        let named = text(e, &["name", "displayName"]).map(str::to_string);
        let site = Site {
            id,
            name: String::new(),
            url,
        };
        let name = named.unwrap_or_else(|| site.host());
        out.push(Site { name, ..site });
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
