//! Keeps trace's own webview the size of its window.
//!
//! The Browser tab's pages are child webviews, which needs Tauri's `unstable`
//! multi-webview mode. In that mode trace's webview is a child of the window too, and
//! on macOS and Windows nothing native resizes it: Tauri does, on each `Resized` event,
//! by dividing the event's physical size by the window's scale factor *as read when
//! the event is handled*. When the window changes display (an external monitor turned
//! off and on, a move between a 1× and a 2× screen) those two can belong to different
//! displays, and the webview ends up twice or half the window's size. The page then
//! lays out for a viewport the window doesn't have, its right side off screen, until
//! a manual resize sends a consistent event.
//!
//! So once the window's geometry has been quiet for a moment, the webview is measured
//! against the window (both read at the same moment) and put back if they disagree.
//! In a healthy window that's a no-op: Tauri's own target is the same rect.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, WindowEvent};

use crate::browser::guard::APP_WEBVIEW;
use crate::platform::ports::AppViewLayout;
use crate::platform::Os;

/// Quiet time after the last geometry event before measuring: a display change, like
/// a live resize, is a burst of events.
const SETTLE: Duration = Duration::from_millis(250);
/// A second look after that, for a display that finishes reconfiguring late.
const RECHECK: Duration = Duration::from_millis(1500);
/// Disagreement, in points, below which the webview counts as fitting (rounding).
const SLACK: f64 = 1.0;

/// Wakes the worker; created with it on the first geometry event.
static KICK: OnceLock<Mutex<Sender<()>>> = OnceLock::new();

/// Called with every window event: one that can change trace's window's size, scale
/// or display schedules a check of its webview. Cheap, and never blocks the event loop.
pub fn on_window_event(app: &AppHandle, label: &str, event: &WindowEvent) {
    if label != APP_WEBVIEW || !Os::sized_by_bounds() {
        return;
    }
    let geometry = matches!(
        event,
        WindowEvent::Resized(_)
            | WindowEvent::Moved(_)
            | WindowEvent::ScaleFactorChanged { .. }
            | WindowEvent::Focused(true)
    );
    if !geometry {
        return;
    }
    let kick = KICK.get_or_init(|| Mutex::new(spawn_worker(app.clone())));
    let _ = kick.lock().unwrap_or_else(|e| e.into_inner()).send(());
}

/// One thread for the app's life. It measures off the event loop's thread on purpose:
/// the app hears a window event *before* Tauri's own resize of the webview for it, and
/// a bounds change made from the main thread runs inline, so it would be overwritten.
/// From here it's queued behind that resize.
fn spawn_worker(app: AppHandle) -> Sender<()> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                if !wait_for_quiet(&rx) {
                    return;
                }
                refit(&app);
                match rx.recv_timeout(RECHECK) {
                    // More events: settle again before measuring.
                    Ok(()) => continue,
                    Err(RecvTimeoutError::Timeout) => {
                        refit(&app);
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
    tx
}

/// Swallow events until none has come for [`SETTLE`]. False once the app is gone.
fn wait_for_quiet(rx: &Receiver<()>) -> bool {
    loop {
        match rx.recv_timeout(SETTLE) {
            Ok(()) => continue,
            Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
}

/// Put trace's webview back over the whole window if it isn't.
fn refit(app: &AppHandle) {
    let (Some(window), Some(view)) = (app.get_window(APP_WEBVIEW), app.get_webview(APP_WEBVIEW))
    else {
        return;
    };
    if window.is_minimized().unwrap_or(true) {
        return;
    }
    let (Ok(inner), Ok(scale), Ok(bounds)) =
        (window.inner_size(), window.scale_factor(), view.bounds())
    else {
        return;
    };
    let want = inner.to_logical::<f64>(scale);
    let at = bounds.position.to_logical::<f64>(scale);
    let size = bounds.size.to_logical::<f64>(scale);
    let have = ViewRect {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
    };
    if !misfits(have, (want.width, want.height)) {
        return;
    }
    // Dev builds say so, to confirm a fix in the `tauri dev` log. Sizes only, no secrets.
    #[cfg(debug_assertions)]
    eprintln!(
        "[trace] webview was {:.0}×{:.0} at ({:.0}, {:.0}) in a {:.0}×{:.0} window; refitted",
        have.width, have.height, have.x, have.y, want.width, want.height
    );
    let _ = view.set_bounds(Rect {
        position: LogicalPosition::new(0.0, 0.0).into(),
        size: LogicalSize::new(want.width, want.height).into(),
    });
}

/// Where trace's webview is in its window, in logical points.
#[derive(Clone, Copy, Debug)]
struct ViewRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Whether a webview at `have` fails to cover a window `want` (width, height) points
/// in size, exactly as Tauri lays it: from the top-left corner, the whole window. An
/// empty window (mid-minimise, a display going away) is never "fixed" to nothing.
fn misfits(have: ViewRect, want: (f64, f64)) -> bool {
    if want.0 < 1.0 || want.1 < 1.0 {
        return false;
    }
    have.x.abs() > SLACK
        || have.y.abs() > SLACK
        || (have.width - want.0).abs() > SLACK
        || (have.height - want.1).abs() > SLACK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: f64, y: f64, width: f64, height: f64) -> ViewRect {
        ViewRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_webview_covering_the_window_is_left_alone() {
        assert!(!misfits(at(0.0, 0.0, 1280.0, 832.0), (1280.0, 832.0)));
    }

    #[test]
    fn sub_point_rounding_is_not_a_misfit() {
        assert!(!misfits(at(0.0, 0.4, 1280.5, 831.6), (1280.0, 832.0)));
    }

    #[test]
    fn a_resize_read_at_the_other_displays_scale_is_caught() {
        // 2560 physical pixels from a 2× screen, divided by a 1× scale: twice too wide,
        // the page's right half off screen.
        assert!(misfits(at(0.0, 0.0, 2560.0, 1664.0), (1280.0, 832.0)));
        // And the other way round: half the window, the rest blank.
        assert!(misfits(at(0.0, 0.0, 640.0, 416.0), (1280.0, 832.0)));
    }

    #[test]
    fn a_webview_pushed_down_or_across_is_caught() {
        assert!(misfits(at(0.0, -832.0, 1280.0, 1664.0), (1280.0, 832.0)));
        assert!(misfits(at(12.0, 0.0, 1280.0, 832.0), (1280.0, 832.0)));
    }

    #[test]
    fn an_empty_window_is_never_fitted_to() {
        assert!(!misfits(at(0.0, 0.0, 1280.0, 832.0), (0.0, 0.0)));
        assert!(!misfits(at(0.0, 0.0, 1280.0, 832.0), (1280.0, 0.0)));
    }
}
