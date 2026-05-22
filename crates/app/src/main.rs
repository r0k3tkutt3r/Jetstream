#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use ccshell_app::state::{default_path, load_from};
use ccshell_core::manager::SessionManager;
use std::sync::Arc;

fn main() {
    tracing_subscriber::fmt::init();

    let manager = Arc::new(SessionManager::new());

    let manifest_path = default_path();
    let manifest = load_from(&manifest_path).unwrap_or_default();

    tauri::Builder::default()
        .manage(manager)
        .manage(std::sync::Mutex::new(manifest))
        .manage(manifest_path)
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::send_user_message,
            commands::cycle_mode,
            commands::interrupt,
            commands::list_sessions,
            commands::close_session,
            commands::list_agents,
            commands::caffeinate_status,
            commands::list_slash_commands,
            commands::replay_session,
            commands::resume_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
