//! `trace-img`: how the Gallery's `<img>`s load. A request names a workspace, a set
//! and a path (one base64url token, so nothing in it needs escaping), and is served
//! only if it comes from trace's own webview and `contain::image_path` admits the
//! path for that set. Anything else is refused with a status, never a file.
//!
//! An image in an agent's chat reply has no set: its token is `{"file": path}`,
//! and `inline` decides it with the same file checks.
//!
//! SVG goes out as `image/svg+xml` with a CSP that allows no scripts, and the
//! Gallery only ever shows it as an `<img>`, where scripts never run anyway.

use base64::Engine;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

use super::{contain, inline, kinds, store};
use crate::browser::guard;

/// What a request asks for.
#[derive(Debug, PartialEq)]
pub struct Ask {
    pub workspace_id: String,
    pub set_id: String,
    pub path: String,
}

/// The token for an image's URL (the renderer builds the same: `src/ipc/gallery.ts`).
pub fn token(ask: &Ask) -> String {
    let json = serde_json::json!([ask.workspace_id, ask.set_id, ask.path]).to_string();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
}

/// The token's JSON, from the request's path (`/<token>`, any query ignored).
fn decode(path: &str) -> Option<serde_json::Value> {
    let raw = path.trim_start_matches('/');
    let raw = raw.split(['?', '#']).next()?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(raw.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The request's `Ask`, from its path (`/<token>`, any query ignored).
pub fn parse(path: &str) -> Option<Ask> {
    let parts: Vec<String> = serde_json::from_value(decode(path)?).ok()?;
    let [workspace_id, set_id, path]: [String; 3] = parts.try_into().ok()?;
    Some(Ask {
        workspace_id,
        set_id,
        path,
    })
}

fn refuse(status: StatusCode, why: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(why.as_bytes().to_vec())
        .unwrap_or_default()
}

/// The response for a request from webview `label`.
pub fn respond(label: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if !guard::may_invoke(label) {
        return refuse(StatusCode::FORBIDDEN, "Not allowed from this page.");
    }
    if request.method() != Method::GET {
        return refuse(StatusCode::METHOD_NOT_ALLOWED, "GET only.");
    }
    let file = match resolve(request.uri().path()) {
        Ok(file) => file,
        Err((status, why)) => return refuse(status, &why),
    };
    let Some(mime) = kinds::mime_for(&file) else {
        return refuse(StatusCode::FORBIDDEN, "Not an image.");
    };
    let Ok(bytes) = std::fs::read(&file) else {
        return refuse(StatusCode::NOT_FOUND, "Couldn't read the file.");
    };
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "private, max-age=3600");
    if kinds::is_svg(&file) {
        response = response.header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        );
    }
    response.body(bytes).unwrap_or_default()
}

/// The file a request's path names: a chat's image, or one of a set's.
fn resolve(path: &str) -> Result<std::path::PathBuf, (StatusCode, String)> {
    let bad = || (StatusCode::BAD_REQUEST, "Not an image address.".to_string());
    if let Some(file) = decode(path).as_ref().and_then(|v| v.get("file")) {
        let file = file.as_str().ok_or_else(bad)?;
        return inline::file(file).map_err(|why| (StatusCode::FORBIDDEN, why));
    }
    let ask = parse(path).ok_or_else(bad)?;
    let sets = store::load(&ask.workspace_id).unwrap_or_default();
    let Some(set) = sets.iter().find(|s| s.id == ask.set_id) else {
        return Err((StatusCode::NOT_FOUND, "No such set.".to_string()));
    };
    contain::image_path(set, &ask.path).map_err(|why| (StatusCode::FORBIDDEN, why))
}

/// The protocol handler: answers off the UI thread.
pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let label = ctx.webview_label().to_string();
    tauri::async_runtime::spawn_blocking(move || responder.respond(respond(&label, &request)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_round_trip() {
        let ask = Ask {
            workspace_id: "ws-1".into(),
            set_id: "s".into(),
            path: r"C:\pics\a b+c.png".into(),
        };
        let t = token(&ask);
        assert!(t
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(parse(&format!("/{t}?v=12")), Some(ask));
        assert_eq!(parse("/not-base64!"), None);
        assert_eq!(parse("/"), None);
    }

    #[test]
    fn other_webviews_are_refused() {
        let req = Request::builder()
            .uri("http://trace-img.localhost/x")
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            respond("browser-ws-page", &req).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(respond("main", &req).status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_chat_image_is_served_by_path_and_only_an_image() {
        let dir = crate::gallery::scan::tests::Scratch::new("protocol-inline");
        let png = dir.file("out/My File.png", b"\x89PNG");
        let txt = dir.file("out/secret.txt", b"x");
        let get = |path: &std::path::Path| {
            let json = serde_json::json!({ "file": path.to_string_lossy() }).to_string();
            let t = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json);
            let req = Request::builder()
                .uri(format!("http://trace-img.localhost/{t}?v=1"))
                .body(Vec::new())
                .unwrap();
            (respond("main", &req), respond("browser-ws-page", &req))
        };
        let (ok, other) = get(&png);
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(other.status(), StatusCode::FORBIDDEN);
        assert_eq!(get(&txt).0.status(), StatusCode::FORBIDDEN);
    }
}
