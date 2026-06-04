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
    // Restore the previously-chosen repo path so the user doesn't redo Settings.
    if let Some(repo) = commands::agent::load_repo_path() {
        *app_state.repo_path.write() = Some(repo);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::jira::connect_jira,
            commands::jira::jira_session,
            commands::jira::disconnect_jira,
            commands::jira::list_jira_boards,
            commands::jira::get_jira_board,
            commands::jira::get_issue_pull_requests,
            commands::jira::transition_jira_issue,
            commands::agent::set_repo_path,
            commands::agent::get_repo_path,
            commands::agent::agent_running,
            commands::agent::start_agent,
            commands::agent::send_agent_input,
            commands::agent::resize_agent,
            commands::agent::stop_agent,
            commands::agent::reset_agent_session,
            commands::pr::raise_pr,
            commands::pr::merge_pr,
            commands::diff::git_diff_summary,
            commands::diff::git_diff_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
