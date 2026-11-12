//! Which of trace's listed servers get a card, and under what name and source:
//! pure, so the rules are tested without a config file or a login.
//!
//! - A server for another region than yours, for a service whose region
//!   trace knows (Pylon's, from its tracker), isn't offered (its login would
//!   never come back), unless it's already added. Regions are per service: an
//!   EU Pylon says nothing about where your Intercom is.
//! - A server still added at a URL its service retired keeps that card (the
//!   way to move it), so the new one isn't offered beside it.
//! - One already in your Claude config, at its URL or a retired one, takes the
//!   config's name, so trace's login stands in for it rather than adding the
//!   server twice.

use super::catalog::{Known, Region, CATALOG};
use super::servers::McpServer;
use super::Source;

/// One listed server's card: the entry, the name to show, where it's from.
#[derive(Debug, PartialEq, Eq)]
pub struct Card {
    pub known: &'static Known,
    pub name: String,
    pub source: Source,
}

fn norm(u: &str) -> String {
    u.trim_end_matches('/').to_ascii_lowercase()
}

/// `url` is `k`'s server, at the URL it has now or one it retired.
pub fn same(k: &Known, url: &str) -> bool {
    norm(url) == norm(k.url) || k.replaces.iter().any(|old| norm(old) == norm(url))
}

/// What trace knows of your region per service, by the service's `logo`.
pub type Regions<'a> = &'a [(&'a str, Region)];

/// Whether to offer `k` given the regions trace knows you're in.
pub fn offered(k: &Known, regions: Regions) -> bool {
    let yours = regions.iter().find(|(service, _)| *service == k.logo);
    match (k.region, yours) {
        (Some(theirs), Some((_, yours))) => theirs == *yours,
        _ => true,
    }
}

/// The cards for trace's list, given the URLs added in trace, the servers in
/// your Claude config and your region per service (where trace knows it).
pub fn catalog_cards(added: &[&str], config: &[McpServer], regions: Regions) -> Vec<Card> {
    let is_added = |url: &str| added.iter().any(|a| norm(a) == norm(url));
    CATALOG
        .iter()
        .filter(|k| offered(k, regions) || is_added(k.url))
        .filter(|k| is_added(k.url) || !k.replaces.iter().any(|old| is_added(old)))
        .map(|k| match config.iter().find(|c| same(k, &c.url)) {
            Some(c) => Card {
                known: k,
                name: c.name.clone(),
                source: Source::Config,
            },
            None => Card {
                known: k,
                name: k.name.to_string(),
                source: Source::Catalog,
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_auth::catalog::by_url;

    const V1: &str = "https://mcp.atlassian.com/v1/mcp";
    const V2: &str = "https://mcp.atlassian.com/v2/mcp";
    const PYLON_EU: &str = "https://mcp.eu.usepylon.com";
    const PYLON_US: &str = "https://mcp.usepylon.com";

    fn card<'a>(cards: &'a [Card], url: &str) -> Option<&'a Card> {
        cards.iter().find(|c| norm(c.known.url) == norm(url))
    }

    fn config(name: &str, url: &str) -> McpServer {
        McpServer {
            name: name.into(),
            url: url.into(),
        }
    }

    #[test]
    fn a_known_region_leaves_out_the_other_regions_server() {
        let eu = by_url(PYLON_EU).expect("EU listed");
        let us = by_url(PYLON_US).expect("US listed");
        let in_eu = [("pylon", Region::Eu)];
        let in_us = [("pylon", Region::Us)];
        assert!(offered(eu, &in_eu) && !offered(us, &in_eu));
        assert!(offered(us, &in_us) && !offered(eu, &in_us));
        assert!(offered(eu, &[]) && offered(us, &[]));
    }

    #[test]
    fn one_services_region_says_nothing_about_anothers() {
        let cards = catalog_cards(&[], &[], &[("pylon", Region::Eu)]);
        assert!(card(&cards, "https://mcp.intercom.com/mcp").is_some());
        assert!(card(&cards, "https://mcp.eu.intercom.com/mcp").is_some());
        assert!(card(&cards, PYLON_US).is_none());
    }

    #[test]
    fn the_other_region_stays_once_added() {
        let cards = catalog_cards(&[PYLON_US], &[], &[("pylon", Region::Eu)]);
        assert!(card(&cards, PYLON_US).is_some() && card(&cards, PYLON_EU).is_some());
    }

    #[test]
    fn v2_is_offered_unless_v1_is_still_added_in_trace() {
        let fresh = catalog_cards(&[], &[], &[]);
        assert_eq!(card(&fresh, V2).map(|c| c.source), Some(Source::Catalog));
        let on_v1 = catalog_cards(&[V1], &[], &[]);
        assert!(card(&on_v1, V2).is_none(), "the v1 card is the way to move");
        let moved = catalog_cards(&[V2], &[], &[]);
        assert!(card(&moved, V2).is_some());
    }

    #[test]
    fn a_v1_server_in_the_claude_config_becomes_the_v2_card_under_its_name() {
        let cards = catalog_cards(&[], &[config("jira", V1)], &[]);
        let c = card(&cards, V2).expect("v2 card");
        assert_eq!((c.name.as_str(), c.source), ("jira", Source::Config));
    }
}
