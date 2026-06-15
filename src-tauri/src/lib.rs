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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
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
            commands::jira::comment_on_issue,
            commands::repos::list_repos,
            commands::repos::add_repo,
            commands::repos::remove_repo,
            commands::repos::issue_repo,
            commands::repos::set_issue_repo,
            commands::repos::list_repo_mappings,
            commands::repos::set_repo_mappings,
            commands::agent::agent_running,
            commands::agent::start_agent,
            commands::agent::start_terminal,
            commands::agent::send_agent_input,
            commands::agent::resize_agent,
            commands::agent::pty_snapshot,
            commands::agent::stop_agent,
            commands::agent::reset_agent_session,
            commands::pr::raise_pr,
            commands::pr::merge_pr,
            commands::pr::pr_details,
            commands::diff::git_diff_summary,
            commands::diff::git_diff_file,
            commands::diff::read_workspace_file,
            commands::editor::open_in_editor,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::rename_session,
            commands::session::archive_session,
            commands::session::unarchive_session,
            commands::session::delete_session,
            commands::session::start_session,
            commands::session::set_session_group,
            commands::session::link_session_to_issue,
            commands::groups::list_session_groups,
            commands::groups::save_session_groups,
            commands::tests::run_tests,
            commands::update::check_app_update,
            commands::update::install_app_update,
            commands::worktrees::list_worktrees,
            commands::worktrees::remove_worktree,
            commands::orchestrator::get_anthropic_key,
            commands::orchestrator::set_anthropic_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
