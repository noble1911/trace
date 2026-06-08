//! trace — Tauri shell.
//!
//! Thin by design: owns `AppState`, `run()`, and command registration only.
//! Feature logic lives in `jira/`, `claude/`, `git`, and thin `commands/*`.

pub mod claude;
pub mod commands;
pub mod git;
pub mod helpers;
pub mod jira;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    // Reconnect from the keychain if a previous session was saved.
    if let Some(conn) = jira::auth::load() {
        *app_state.jira.write() = Some(conn);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::jira::connect_jira,
            commands::jira::jira_session,
            commands::jira::jira_current_user,
            commands::jira::disconnect_jira,
            commands::jira::list_jira_boards,
            commands::jira::get_jira_board,
            commands::jira::get_issue_pull_requests,
            commands::jira::transition_jira_issue,
            commands::repos::list_repos,
            commands::repos::add_repo,
            commands::repos::remove_repo,
            commands::repos::issue_repo,
            commands::repos::set_issue_repo,
            commands::agent::agent_running,
            commands::agent::start_agent,
            commands::agent::start_terminal,
            commands::agent::send_agent_input,
            commands::agent::resize_agent,
            commands::agent::stop_agent,
            commands::agent::reset_agent_session,
            commands::pr::raise_pr,
            commands::pr::merge_pr,
            commands::pr::pr_details,
            commands::diff::git_diff_summary,
            commands::diff::git_diff_file,
            commands::editor::open_in_editor,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::archive_session,
            commands::session::unarchive_session,
            commands::session::delete_session,
            commands::session::start_session,
            commands::tests::run_tests,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
