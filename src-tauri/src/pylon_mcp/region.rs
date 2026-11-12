//! Which of Pylon's MCP servers (US or EU) the board uses. Pylon's regions
//! are separate logins: an EU workspace's account doesn't exist on the US
//! server, so the wrong one never validates.
//!
//! The rule, for `connect_pylon_mcp`:
//! 1. A region the caller names wins.
//! 2. Else, if trace is logged in to exactly one of the two, that one.
//! 3. Logged in to both: the region trace already knows (the saved board
//!    record's server, else the saved API connection's region); knowing none,
//!    try each (US, then EU) and keep the first whose `get_me` validates.
//! 4. Logged in to neither: log in to the known region's server, else US's
//!    (the catalog offers both while the region is unknown; US is Pylon's
//!    default, as on REST).

use crate::issues::{mcp_link, ProviderKind};
use crate::mcp_auth::catalog::Region;

pub const US_URL: &str = "https://mcp.usepylon.com";
pub const EU_URL: &str = "https://mcp.eu.usepylon.com";

/// A region's server.
pub fn url(region: Region) -> &'static str {
    match region {
        Region::Us => US_URL,
        Region::Eu => EU_URL,
    }
}

/// Which region's server `url` is, if it's one of Pylon's.
pub fn of_url(url: &str) -> Option<Region> {
    let norm = |u: &str| u.trim_end_matches('/').to_ascii_lowercase();
    [Region::Us, Region::Eu]
        .into_iter()
        .find(|r| norm(self::url(*r)) == norm(url))
}

/// `"us"` or `"eu"`, as the frontend names a region.
pub fn parse(s: &str) -> Result<Region, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "us" => Ok(Region::Us),
        "eu" => Ok(Region::Eu),
        other => Err(format!("Unknown Pylon region: {other}")),
    }
}

/// What connecting does.
#[derive(Debug, PartialEq)]
pub enum Plan {
    /// Use this region's server (logging in first if need be).
    Use(Region),
    /// Logged in to both and no region known: the first of these that validates.
    Probe([Region; 2]),
}

/// The rule (see the module doc), pure.
pub fn plan(
    requested: Option<Region>,
    logged_in: impl Fn(Region) -> bool,
    known: Option<Region>,
) -> Plan {
    if let Some(r) = requested {
        return Plan::Use(r);
    }
    match (logged_in(Region::Us), logged_in(Region::Eu)) {
        (true, false) => Plan::Use(Region::Us),
        (false, true) => Plan::Use(Region::Eu),
        (true, true) => known.map_or(Plan::Probe([Region::Us, Region::Eu]), Plan::Use),
        (false, false) => Plan::Use(known.unwrap_or(Region::Us)),
    }
}

/// The region trace already knows for Pylon: the saved board record's
/// server, else the saved API connection's region. Also what Integrations →
/// MCP servers uses to offer only your region's Pylon server.
pub fn known() -> Option<Region> {
    let from_link = mcp_link::load(ProviderKind::Pylon).and_then(|l| of_url(&l.server_url));
    from_link.or_else(|| {
        crate::pylon::auth::load().map(|c| match c.base_url == crate::pylon::EU_BASE_URL {
            true => Region::Eu,
            false => Region::Us,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: fn(Region) -> bool = |_| false;
    const BOTH: fn(Region) -> bool = |_| true;

    #[test]
    fn a_named_region_wins() {
        assert_eq!(
            plan(Some(Region::Eu), BOTH, Some(Region::Us)),
            Plan::Use(Region::Eu)
        );
        assert_eq!(plan(Some(Region::Us), NONE, None), Plan::Use(Region::Us));
    }

    #[test]
    fn the_one_logged_in_is_used() {
        let eu_only = |r: Region| r == Region::Eu;
        assert_eq!(plan(None, eu_only, Some(Region::Us)), Plan::Use(Region::Eu));
        let us_only = |r: Region| r == Region::Us;
        assert_eq!(plan(None, us_only, None), Plan::Use(Region::Us));
    }

    #[test]
    fn both_logged_in_takes_the_known_region_else_probes() {
        assert_eq!(plan(None, BOTH, Some(Region::Eu)), Plan::Use(Region::Eu));
        assert_eq!(
            plan(None, BOTH, None),
            Plan::Probe([Region::Us, Region::Eu])
        );
    }

    #[test]
    fn neither_logged_in_logs_in_to_the_known_region_else_us() {
        assert_eq!(plan(None, NONE, Some(Region::Eu)), Plan::Use(Region::Eu));
        assert_eq!(plan(None, NONE, None), Plan::Use(Region::Us));
    }

    #[test]
    fn urls_and_names_round_trip() {
        assert_eq!(of_url("https://mcp.eu.usepylon.com/"), Some(Region::Eu));
        assert_eq!(of_url(US_URL), Some(Region::Us));
        assert_eq!(of_url("https://mcp.atlassian.com/v2/mcp"), None);
        assert_eq!(parse("EU"), Ok(Region::Eu));
        assert!(parse("apac").is_err());
        // The catalog lists the same two servers.
        for r in [Region::Us, Region::Eu] {
            let k = crate::mcp_auth::catalog::by_url(url(r)).expect("in the catalog");
            assert_eq!(k.region, Some(r));
        }
    }
}
