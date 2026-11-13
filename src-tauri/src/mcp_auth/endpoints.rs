//! What discovery may tell trace to talk to. A server's metadata names the
//! authorization, token and registration endpoints; the code, the client
//! secret and the refresh token go to them, so each must be `https` (loopback
//! excepted, for local servers). A bad one is an error, not a skipped field.

use reqwest::Url;

/// `url` if it is `https`, or `http` to a loopback host; else why not.
pub fn require_https(label: &str, url: &str) -> Result<String, String> {
    let bad = || format!("The server's {label} isn't an https URL, so trace won't log in to it.");
    let parsed = Url::parse(url).map_err(|_| bad())?;
    let loopback = match parsed.host_str() {
        Some(h) => h == "localhost" || h == "127.0.0.1" || h == "[::1]",
        None => return Err(bad()),
    };
    match parsed.scheme() {
        "https" => Ok(url.to_string()),
        "http" if loopback => Ok(url.to_string()),
        _ => Err(bad()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_http_endpoint_is_refused_unless_it_is_loopback() {
        assert!(require_https("token endpoint", "https://auth.example.com/token").is_ok());
        assert!(require_https("token endpoint", "http://127.0.0.1:8080/token").is_ok());
        assert!(require_https("token endpoint", "http://localhost/token").is_ok());
        assert!(require_https("token endpoint", "http://auth.example.com/token").is_err());
        assert!(require_https("token endpoint", "http://127.0.0.1.evil.com/token").is_err());
        assert!(require_https("token endpoint", "ftp://auth.example.com/token").is_err());
        assert!(require_https("token endpoint", "not a url").is_err());
    }
}
