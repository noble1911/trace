//! trace — Tauri shell.
//!
//! Thin by design: owns `AppState`, `run()`, and command registration only.
//! Feature logic lives in `jira/`, `claude/`, `schedule/`, `git`, and thin `commands/*`.

pub mod activity;
pub mod agent_session;
pub mod agent_tools;
pub mod board_settings;
pub mod browser;
pub mod claude;
pub mod cleanup;
pub mod commands;
pub mod conductor_import;
pub mod custom_boards;
pub mod diff_parse;
pub mod diff_summary;
pub mod execution;
pub mod gallery;
pub mod git;
pub mod github;
pub mod helpers;
pub mod interrupted;
pub mod issues;
pub mod jira;
pub mod jira_mcp;
pub mod keep_awake;
mod mcp_auth;
pub mod mcp_client;
pub mod permissions;
pub mod plans;
pub mod platform;
pub mod preflight;
pub mod pylon;
pub mod pylon_mcp;
// The homepage clip recorder's hooks; never in a release build (site/README.md).
#[cfg(feature = "recording")]
pub mod recording;
pub mod repo_catalog;
pub mod saved_prompts;
pub mod schedule;
pub mod state;
pub mod workspace_dir;
pub mod worktree_diff;
pub mod worktree_files;

use std::sync::atomic::Ordering;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any thread starts, so nothing trace spawns inherits the driver's token.
    #[cfg(feature = "recording")]
    recording::take_launch_env();
    helpers::secure_config_dir();
    let app_state = AppState::new();

    // Reconnect every issue tracker with a saved session.
    for provider in issues::session::restore_all() {
        app_state
            .providers
            .write()
            .insert(provider.kind(), provider);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // Copies go through the system clipboard, not WebKit's (`src/ipc/clipboard.ts`).
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        // The Gallery's images; only trace's own webview is served (`gallery::protocol`).
        .register_asynchronous_uri_scheme_protocol(gallery::SCHEME, gallery::protocol::handle)
        .setup(|app| {
            // Agents the last run was cut off from, offered back by the renderer.
            interrupted::collect_at_launch(&app.state::<AppState>());
            // The scheduled-prompt engine fires from Rust, whatever the UI is doing.
            schedule::runner::start(app.handle().clone());
            // Idle-workspace cleanup; a no-op until enabled in Settings.
            cleanup::runner::start(app.handle().clone());
            // The computer stays awake while agents run, unless switched off in Settings.
            keep_awake::start(app.handle().clone());
            // The peer server: listens on the Tailscale IP while Settings has it on.
            execution::peer::supervisor::start(app.handle().clone());
            // Worktree setup hooks report progress to the renderer.
            repo_catalog::setup::init(app.handle().clone());
            Ok(())
        })
        // Every command is refused to any webview but trace's own (the Browser tab's
        // pages are webviews too): `browser::guard`.
        .invoke_handler(browser::guard::app_only(tauri::generate_handler![
            commands::activity::list_activity,
            commands::agent_tools::set_agent_tools,
            commands::agent_tools::agent_tool_result,
            commands::interrupted::interrupted_agents,
            commands::interrupted::resume_interrupted_agents,
            commands::interrupted::dismiss_interrupted_agents,
            commands::activity::record_activity,
            commands::activity::clear_activity,
            commands::activity::import_activity,
            commands::issues::connect_jira,
            commands::issues::connect_pylon,
            commands::issues_mcp::connect_jira_mcp,
            commands::issues_mcp::connect_pylon_mcp,
            commands::issues::provider_sessions,
            commands::issues::provider_current_user,
            commands::issues::disconnect_provider,
            commands::issues::list_boards,
            commands::issues::get_board,
            commands::issues::get_issue_pull_requests,
            commands::issues::transition_issue,
            commands::issues::comment_on_issue,
            commands::issues::list_issue_comments,
            commands::board_settings::board_settings_get,
            commands::board_settings::board_settings_set,
            commands::custom_boards::custom_board_create,
            commands::custom_boards::custom_board_config,
            commands::custom_boards::custom_board_rename,
            commands::custom_boards::custom_board_delete,
            commands::custom_boards::custom_column_add,
            commands::custom_boards::custom_column_update,
            commands::custom_boards::custom_column_move,
            commands::custom_boards::custom_column_delete,
            commands::custom_boards::custom_card_create,
            commands::custom_boards::custom_card_update,
            commands::custom_boards::custom_card_delete,
            commands::custom_boards::custom_card_type_add,
            commands::custom_boards::custom_card_type_update,
            commands::custom_boards::custom_card_type_delete,
            commands::conductor_import::conductor_import_available,
            commands::conductor_import::conductor_import_preview,
            commands::conductor_import::conductor_import_apply,
            commands::repos::list_repos,
            commands::repos::add_repo,
            commands::repo_guard::check_repo_path,
            commands::repos::remove_repo,
            commands::repos::issue_repo,
            commands::repos::set_issue_repo,
            commands::repos::list_repo_mappings,
            commands::repos::set_repo_mappings,
            commands::repo_setup::repo_details,
            commands::repo_setup::set_repo_setup,
            commands::repo_setup::suggest_repo_setup,
            commands::repo_setup::clone_root,
            commands::repo_setup::set_clone_root,
            commands::github::github_status,
            commands::github::github_sign_in_token,
            commands::github::github_import_gh,
            commands::github::github_device_start,
            commands::github::github_device_wait,
            commands::github::github_device_cancel,
            commands::github::github_sign_out,
            commands::github::github_owners,
            commands::github::github_repos,
            commands::github::github_clone,
            commands::agent::agent_running,
            commands::agent::live_workspaces,
            commands::agent_start::start_agent,
            commands::issue_host::issue_host,
            commands::terminal::start_terminal,
            commands::tailscale::tailscale_status,
            commands::peer_server::peer_server_status,
            commands::peer_server::set_peer_server,
            commands::preflight::preflight_checks,
            commands::preflight::preflight_install,
            commands::preflight::preflight_sign_in,
            commands::preflight::preflight_cancel_sign_in,
            commands::agent::detach_agent,
            commands::session_host::agent_capabilities,
            commands::sandbox_state::sandbox_state,
            commands::github::github_remove_account,
            commands::github::github_set_primary,
            commands::repo_setup::set_repo_github_account,
            commands::mcp::mcp_servers,
            commands::mcp::mcp_connect,
            commands::mcp::mcp_add,
            commands::mcp::mcp_set_use,
            commands::mcp::mcp_disconnect,
            commands::vercel::sandbox_lifetime,
            commands::vercel::set_sandbox_lifetime,
            commands::vercel::sandbox_size,
            commands::vercel::set_sandbox_size,
            commands::vercel::vercel_status,
            commands::vercel::connect_vercel,
            commands::vercel::disconnect_vercel,
            commands::vercel::set_claude_credential,
            commands::vercel::clear_claude_credential,
            commands::vercel::list_remote_sessions,
            commands::vercel::join_remote_session,
            commands::agent::send_agent_input,
            commands::agent::resize_agent,
            commands::snapshot::pty_snapshot,
            commands::agent::stop_agent,
            commands::agent::reset_agent_session,
            commands::agent_chat::chat_agent_state,
            commands::agent_chat::chat_agent_brands,
            commands::agent_chat::set_agent_transport,
            commands::agent_chat::send_chat_message,
            commands::agent_chat::save_chat_attachment,
            commands::agent_chat::attachment_preview,
            commands::composer::existing_attachments,
            commands::agent_chat::answer_chat_prompt,
            commands::agent_chat::interrupt_chat_agent,
            commands::agent_chat::stop_chat_subagent,
            commands::agent_chat::load_journal,
            commands::agent_options::agent_options,
            commands::agent_options::set_agent_option,
            commands::agent_options::claude_catalog,
            commands::pr::raise_pr,
            commands::pr::merge_pr,
            commands::pr_watch::workspace_prs,
            commands::pr_watch::pr_thread,
            commands::workspace::workspace_info,
            commands::workspace::sessions_overview,
            commands::transcript::read_transcript,
            commands::diff::git_diff_summary,
            commands::diff::git_diff_file,
            commands::diff::read_workspace_file,
            commands::files::list_workspace_files,
            commands::plans::load_plan_docs,
            commands::plans::publish_plan_doc,
            commands::plans::remove_plan_doc,
            commands::plans::export_plan_doc,
            commands::plans::export_plan_pdf,
            commands::browser::browser_pages,
            commands::browser::browser_open,
            commands::browser::browser_go,
            commands::browser::browser_select,
            commands::browser::browser_close,
            commands::browser::browser_show,
            commands::browser::browser_hide,
            commands::browser::browser_act,
            commands::gallery::gallery_show,
            commands::gallery::gallery_sets,
            commands::gallery::gallery_list,
            commands::gallery::gallery_remove,
            commands::gallery::gallery_open,
            commands::editor::open_in_editor,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::rename_session,
            commands::session::archive_session,
            commands::session::unarchive_session,
            commands::session::delete_session,
            commands::session::start_session,
            commands::groups::set_session_group,
            commands::session_link::link_session_to_issue,
            commands::session_agents::add_session_agent,
            commands::session_agents::remove_session_agent,
            commands::session_agents::start_session_agent,
            commands::schedules::list_scheduled_prompts,
            commands::schedules::list_schedule_runs,
            commands::schedules::save_scheduled_prompt,
            commands::schedules::set_scheduled_prompt_enabled,
            commands::schedules::delete_scheduled_prompt,
            commands::schedules::run_scheduled_prompt_now,
            commands::schedules::stop_scheduled_run,
            commands::schedules::preview_schedule,
            commands::schedules::run_conversation,
            commands::schedules::continue_run_as_session,
            commands::schedules::export_scheduled_prompts,
            commands::schedules::read_scheduled_prompts_file,
            commands::schedules::import_scheduled_prompts,
            commands::groups::list_session_groups,
            commands::groups::save_session_groups,
            commands::session_order::list_session_order,
            commands::session_order::set_session_list,
            commands::permissions::list_permission_rules,
            commands::permissions::save_permission_rule,
            commands::permissions::delete_permission_rule,
            commands::saved_prompts::list_saved_prompts,
            commands::saved_prompts::save_saved_prompt,
            commands::saved_prompts::delete_saved_prompt,
            commands::sound::list_notify_sounds,
            commands::sound::play_notify_sound,
            commands::tests::run_tests,
            commands::update::check_app_update,
            commands::update::install_app_update,
            commands::worktrees::list_worktrees,
            commands::worktrees::remove_worktree,
            commands::cleanup::get_cleanup_settings,
            commands::cleanup::set_cleanup_settings,
            commands::cleanup::preview_cleanup,
            commands::cleanup::run_cleanup_now,
            commands::keep_awake::get_keep_awake,
            commands::keep_awake::set_keep_awake,
            commands::orchestrator::get_anthropic_key,
            commands::orchestrator::set_anthropic_key,
            commands::orchestrator::orchestrator_cli,
            commands::providers::moonshot_key_configured,
            commands::providers::set_moonshot_key,
            commands::providers::wafer_key_configured,
            commands::providers::set_wafer_key,
            commands::providers::deepseek_key_configured,
            commands::providers::set_deepseek_key,
            #[cfg(feature = "recording")]
            commands::recording::recording_bridge,
            #[cfg(feature = "recording")]
            commands::recording::recording_viewport,
            #[cfg(feature = "recording")]
            commands::recording::recording_snapshot,
            #[cfg(feature = "recording")]
            commands::recording::recording_capture_start,
            #[cfg(feature = "recording")]
            commands::recording::recording_capture_stop,
        ]))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Dev builds say why the app is going (a window closing, a quit asked
            // for), so an unexpected exit leaves a reason in the `tauri dev` log.
            #[cfg(debug_assertions)]
            match &event {
                tauri::RunEvent::ExitRequested { code, .. } => {
                    eprintln!("[trace] exit requested (code {code:?})");
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                } => eprintln!("[trace] window {label:?}: close requested"),
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } => eprintln!("[trace] window {label:?}: destroyed"),
                tauri::RunEvent::Exit => eprintln!("[trace] exiting"),
                _ => {}
            }
            // Quitting or restarting for an update kills every agent; mark it, so
            // they're remembered as interrupted rather than finished.
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.shutting_down.store(true, Ordering::SeqCst);
                // A PTY's agent ends with its pseudo-terminal; a chat agent has to be stopped.
                agent_session::runtime::stop_all_now(&state);
                keep_awake::release_blocking();
            }
        });
}
