#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use ccshell_app::state::{default_path, load_from};
use ccshell_core::manager::SessionManager;
use std::sync::Arc;

fn main() {
    use tracing_subscriber::{EnvFilter, FmtSubscriber};

    let sub = FmtSubscriber::builder()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .finish();
    tracing::subscriber::set_global_default(sub).ok();

    let manager = Arc::new(SessionManager::new());

    let manifest_path = default_path();
    let manifest = load_from(&manifest_path).unwrap_or_default();

    let cmd_runner: commands::CommandRunnerState = std::sync::Mutex::new(None);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(manager)
        .manage(std::sync::Mutex::new(manifest))
        .manage(manifest_path)
        .manage(cmd_runner)
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::send_user_message,
            commands::cycle_mode,
            commands::interrupt,
            commands::list_sessions,
            commands::close_session,
            commands::list_agents,
            commands::get_default_cwd,
            commands::caffeinate_status,
            commands::list_slash_commands,
            commands::replay_session,
            commands::resume_session,
            commands::list_sessions_for_cwd,
            commands::get_last_cwd,
            commands::set_last_cwd,
            commands::get_directory_config,
            commands::set_directory_config,
            commands::pick_directory,
            commands::run_directory_command,
            commands::start_command,
            commands::send_command_input,
            commands::resize_command,
            commands::kill_command,
            commands::get_command_buffer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
