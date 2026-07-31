//! trace — Tauri shell.
//!
//! Thin by design: owns `AppState`, `run()`, and command registration only.
//! Feature logic lives in `jira/`, `claude/`, `git`, and thin `commands/*`.

pub mod claude;
pub mod commands;
pub mod git;
pub mod helpers;
pub mod issues;
pub mod jira;
pub mod pylon;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    // Reconnect every issue tracker with a saved session.
    for provider in issues::session::restore_all() {
        app_state.providers.write().insert(provider.kind(), provider);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::issues::connect_jira,
            commands::issues::connect_pylon,
            commands::issues::provider_sessions,
            commands::issues::provider_current_user,
            commands::issues::disconnect_provider,
            commands::issues::list_boards,
            commands::issues::get_board,
            commands::issues::get_issue_pull_requests,
            commands::issues::transition_issue,
            commands::issues::comment_on_issue,
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
            commands::rich_output::load_rich_output,
            commands::rich_output::save_rich_output,
            commands::editor::open_in_editor,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::rename_session,
            commands::session::archive_session,
            commands::session::unarchive_session,
            commands::session::delete_session,
            commands::session::start_session,
            commands::session::set_session_group,
            commands::session_link::link_session_to_issue,
            commands::session_agents::add_session_agent,
            commands::session_agents::remove_session_agent,
            commands::session_agents::start_session_agent,
            commands::groups::list_session_groups,
            commands::groups::save_session_groups,
            commands::tests::run_tests,
            commands::update::check_app_update,
            commands::update::install_app_update,
            commands::worktrees::list_worktrees,
            commands::worktrees::remove_worktree,
            commands::orchestrator::get_anthropic_key,
            commands::orchestrator::set_anthropic_key,
            commands::orchestrator::orchestrator_cli,
            commands::providers::moonshot_key_configured,
            commands::providers::set_moonshot_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
