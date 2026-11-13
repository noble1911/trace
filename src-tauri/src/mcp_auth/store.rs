//! trace's own MCP logins, in a user-only file like every credential: per
//! server, the tokens it holds; per authorization server, the client trace is
//! registered as. Never Claude Code's tokens (refreshing those could rotate
//! them out from under the local CLI), never sent to the renderer, never logged.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::catalog::Auth;
use super::oauth::{self, Client, Tokens};
use crate::helpers::persist::{self, Style};

/// A server trace is logged in to.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub name: String,
    pub url: String,
    pub issuer: String,
    pub resource: String,
    pub token_endpoint: String,
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Epoch ms; None when the server didn't say.
    #[serde(default)]
    pub expires_at: Option<u64>,
}

impl std::fmt::Debug for Grant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Grant({} {}, until {:?})",
            self.name, self.url, self.expires_at
        )
    }
}

/// A server added in trace, and where its agents get it.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    pub name: String,
    pub url: String,
    pub auth: Auth,
    /// For `Key`: the header and the pasted value.
    #[serde(default)]
    pub key: Option<(String, String)>,
    /// Agents on this computer get it, through trace's proxy (`proxy`).
    pub local: bool,
    /// Agents in a cloud sandbox get it, the token added by its network.
    pub remote: bool,
    /// The service it is, for its logo: one of your own added from a
    /// self-hosted service's card (Metabase). None for any other.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
}

impl std::fmt::Debug for Added {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Added({} {} {:?}, local {}, remote {}, key {})",
            self.name,
            self.url,
            self.auth,
            self.local,
            self.remote,
            self.key.is_some()
        )
    }
}

impl Added {
    /// Its address on trace's proxy: `/mcp-proxy/<slug>`.
    pub fn slug(&self) -> String {
        crate::helpers::slugify(&self.name)
    }
}

#[derive(Default, Serialize, Deserialize)]
struct File {
    /// By server URL: what's been added, and how it's used.
    #[serde(default)]
    servers: BTreeMap<String, Added>,
    /// By server URL.
    #[serde(default)]
    grants: BTreeMap<String, Grant>,
    /// By issuer: what trace is registered as there.
    #[serde(default)]
    clients: BTreeMap<String, Client>,
}

fn path() -> PathBuf {
    crate::helpers::trace_dir().join("mcp-logins.json")
}

fn read() -> File {
    persist::read_or_log::<File>(&path())
}

fn update<R>(f: impl FnOnce(&mut File) -> R) -> Result<R, String> {
    persist::update(&path(), Style::Pretty, f)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Every server added in trace.
pub fn added() -> Vec<Added> {
    read().servers.into_values().collect()
}

/// Add (or replace) one. Its name must be one no other added server has.
pub fn add(server: Added) -> Result<(), String> {
    update(|f| {
        let clash = f
            .servers
            .values()
            .any(|s| s.url != server.url && s.slug() == server.slug());
        if clash || server.slug() == "trace" {
            return Err(format!("There's already a server called {}.", server.name));
        }
        f.servers.insert(server.url.clone(), server);
        Ok(())
    })?
}

/// Where its agents get it.
pub fn set_use(url: &str, local: bool, remote: bool) -> Result<(), String> {
    update(|f| match f.servers.get_mut(url) {
        Some(s) => {
            s.local = local;
            s.remote = remote;
            Ok(())
        }
        None => Err("That server isn't added.".to_string()),
    })?
}

/// Remove it and trace's login to it.
pub fn remove(url: &str) -> Result<(), String> {
    update(|f| {
        f.servers.remove(url);
        f.grants.remove(url);
    })
}

/// Every server trace is logged in to.
pub fn grants() -> Vec<Grant> {
    read().grants.into_values().collect()
}

pub fn client_for(issuer: &str) -> Option<Client> {
    read().clients.get(issuer).cloned()
}

pub fn save_client(issuer: &str, client: &Client) -> Result<(), String> {
    update(|f| {
        f.clients.insert(issuer.to_string(), client.clone());
    })
}

/// A grant from tokens just received.
pub fn grant_from(name: &str, url: &str, d: &oauth::Discovered, t: Tokens) -> Grant {
    Grant {
        name: name.to_string(),
        url: url.to_string(),
        issuer: d.issuer.clone(),
        resource: d.resource.clone(),
        token_endpoint: d.token_endpoint.clone(),
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: t.expires_in.map(|s| now_ms() + s * 1000),
    }
}

pub fn save(grant: &Grant) -> Result<(), String> {
    update(|f| {
        f.grants.insert(grant.url.clone(), grant.clone());
    })
}

/// Refreshed when it has less than this left.
const REFRESH_WITHIN_MS: u64 = 10 * 60 * 1000;

/// Whether `grant` should be refreshed at `now`.
pub fn due(grant: &Grant, now: u64) -> bool {
    grant
        .expires_at
        .is_some_and(|at| at.saturating_sub(REFRESH_WITHIN_MS) <= now)
}

/// One refresh at a time, process-wide: held across read, refresh and save so
/// concurrent calls near expiry make one refresh (a rotating refresh token
/// can only be used once). No other lock is taken while it is held beyond the
/// logins file's own, which `read`/`save` take and release themselves.
static REFRESH: Mutex<()> = Mutex::new(());

/// `grant` with a token good for a while yet: refreshed (and saved) when it's
/// close to expiring and can be. Err when it has expired and can't be.
pub fn fresh(grant: Grant) -> Result<Grant, String> {
    if !due(&grant, now_ms()) {
        return Ok(grant);
    }
    fresh_with(
        grant,
        |url| read().grants.get(url).cloned(),
        |g, refresh| {
            let client = client_for(&g.issuer).ok_or("trace isn't registered there.")?;
            oauth::refresh(&g.token_endpoint, &client, &g.resource, refresh)
        },
        save,
    )
}

/// [`fresh`] over how to reload a grant, renew it and save it.
fn fresh_with(
    grant: Grant,
    current: impl Fn(&str) -> Option<Grant>,
    renew: impl Fn(&Grant, &str) -> Result<Tokens, String>,
    store: impl Fn(&Grant) -> Result<(), String>,
) -> Result<Grant, String> {
    let _one_at_a_time = REFRESH.lock().unwrap_or_else(|e| e.into_inner());
    // Another call may have refreshed while this one waited.
    let Some(grant) = current(&grant.url) else {
        return Err(format!("Your {} login was removed.", grant.name));
    };
    if !due(&grant, now_ms()) {
        return Ok(grant);
    }
    let Some(refresh) = grant.refresh_token.clone() else {
        return expired_or(grant);
    };
    match renew(&grant, &refresh) {
        Ok(t) => {
            let renewed = Grant {
                access_token: t.access_token,
                // A server may rotate it; else the old one stays good.
                refresh_token: t.refresh_token.or(Some(refresh)),
                expires_at: t.expires_in.map(|s| now_ms() + s * 1000),
                ..grant
            };
            store(&renewed)?;
            Ok(renewed)
        }
        Err(_) => expired_or(grant),
    }
}

/// Not refreshable: still usable until it expires.
fn expired_or(grant: Grant) -> Result<Grant, String> {
    match grant.expires_at {
        Some(at) if at <= now_ms() => Err(format!(
            "Your {} login has expired: connect it again.",
            grant.name
        )),
        _ => Ok(grant),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(expires_at: Option<u64>) -> Grant {
        Grant {
            name: "sentry".into(),
            url: "https://mcp.sentry.dev/mcp".into(),
            issuer: "https://mcp.sentry.dev".into(),
            resource: "https://mcp.sentry.dev/mcp".into(),
            token_endpoint: "https://mcp.sentry.dev/oauth/token".into(),
            access_token: "secret-access".into(),
            refresh_token: Some("secret-refresh".into()),
            expires_at,
        }
    }

    #[test]
    fn refreshed_ten_minutes_before_it_expires() {
        let now = 1_000_000_000;
        assert!(!due(&grant(Some(now + 11 * 60 * 1000)), now));
        assert!(due(&grant(Some(now + 9 * 60 * 1000)), now));
        assert!(!due(&grant(None), now), "no expiry said: used as is");
    }

    #[test]
    fn a_grant_never_shows_its_tokens() {
        let shown = format!("{:?}", grant(None));
        assert!(!shown.contains("secret"));
    }

    #[test]
    fn concurrent_calls_near_expiry_refresh_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let stale = grant(Some(now_ms() + 1000));
        let saved = Mutex::new(stale.clone());
        let renewals = AtomicUsize::new(0);
        std::thread::scope(|s| {
            for _ in 0..2 {
                s.spawn(|| {
                    let got = fresh_with(
                        stale.clone(),
                        |_| Some(saved.lock().unwrap().clone()),
                        |_, _| {
                            renewals.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(std::time::Duration::from_millis(100));
                            Ok(Tokens {
                                access_token: "new".into(),
                                refresh_token: None,
                                expires_in: Some(3600),
                            })
                        },
                        |g| {
                            *saved.lock().unwrap() = g.clone();
                            Ok(())
                        },
                    )
                    .expect("fresh");
                    assert_eq!(got.access_token, "new");
                });
            }
        });
        assert_eq!(renewals.load(Ordering::SeqCst), 1);
    }
}
