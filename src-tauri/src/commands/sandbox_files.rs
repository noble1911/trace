//! The Files tab's reads for a session in a sandbox, sent to the sandbox
//! (`execution::sandbox::files`) instead of a local folder. `commands/diff.rs`
//! and `commands/files.rs` ask here first.

use crate::execution::sandbox::files::RemoteDir;
use crate::execution::sandbox::SandboxProvider;
use crate::execution::vercel::{auth, Vercel};
use crate::execution::SessionHost;

/// Run `read` on `workspace_id`'s checkout in its sandbox. None when it isn't a
/// sandbox session: the caller reads its local folder.
pub(crate) fn with_remote<T>(
    workspace_id: &str,
    read: impl FnOnce(&RemoteDir) -> Result<T, String>,
) -> Option<Result<T, String>> {
    let host = crate::commands::issue_host::host_of(workspace_id)?;
    let SessionHost::Vercel { sandbox, .. } = &host else {
        return Some(Err(
            "Files aren't available on another computer yet.".to_string()
        ));
    };
    Some((|| {
        let conn = auth::load().ok_or("Connect Vercel in Integrations first.")?;
        let vercel = Vercel::new(conn);
        let session_id = vercel
            .find(sandbox)?
            .filter(|s| s.is_running())
            .and_then(|s| s.session_id)
            .ok_or("Its sandbox isn't running: start the session to see its files.")?;
        let dir = crate::commands::session_host::sandbox_cwd(&host);
        read(&RemoteDir {
            provider: &vercel,
            session_id: &session_id,
            dir: &dir,
        })
    })())
}
