//! Ports and adapters for the operating system: the only home for OS-specific code.
//!
//! `ports` says what trace needs, and exactly one adapter implements it for [`Os`] in
//! any build. macOS and Linux share `unix`, overriding only what really differs.
//! `paths` and `acl` are pure logic rather than ports, so their Windows rules are tested
//! everywhere.

pub mod acl;
pub mod install_hints;
pub mod paths;
pub mod ports;
pub mod process;
#[cfg(test)]
pub mod test_links;
#[cfg(test)]
pub mod test_process;

/// The operating system this build runs on. Every port is implemented for it.
pub struct Os;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_pdf;
#[cfg(all(target_os = "macos", feature = "recording"))]
mod macos_snapshot;
// Elsewhere the recorder drives the webview's own DevTools protocol.
#[cfg(all(not(target_os = "macos"), feature = "recording"))]
impl ports::PageSnapshot for Os {}
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_awake;
#[cfg(windows)]
mod windows_job;
#[cfg(windows)]
mod windows_pdf;
