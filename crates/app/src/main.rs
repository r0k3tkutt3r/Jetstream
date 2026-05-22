#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use ccshell_core::manager::SessionManager;
use std::sync::Arc;

fn main() {
    tracing_subscriber::fmt::init();

    let manager = Arc::new(SessionManager::new());

    tauri::Builder::default()
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::send_user_message,
            commands::cycle_mode,
            commands::interrupt,
            commands::list_sessions,
            commands::close_session,
            commands::list_agents,
            commands::caffeinate_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
