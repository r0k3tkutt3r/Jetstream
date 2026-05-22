use ccshell_core::agents::AgentRegistry;
use ccshell_core::manager::SessionManager;
use ccshell_core::session::{SessionConfig, cycle_mode as core_cycle_mode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub cwd: PathBuf,
    pub name: String,
    pub agent: Option<String>,
    pub resume_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub mode: String,
}

#[tauri::command]
pub async fn spawn_session(
    app: AppHandle,
    manager: State<'_, Arc<SessionManager>>,
    args: SpawnArgs,
) -> Result<SessionSummary, String> {
    let cfg = SessionConfig {
        binary: which_claude(),
        cwd: args.cwd,
        name: args.name,
        agent: args.agent,
        resume_id: args.resume_id,
    };
    let session = manager.spawn(cfg).await.map_err(|e| e.to_string())?;

    // Fan-out events to the webview
    let id = session.id;
    let mut rx = session.subscribe();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Ok(ev) = rx.recv().await {
            let _ = app_clone.emit(&format!("session://{id}"), &ev);
        }
    });

    Ok(SessionSummary {
        id: session.id.to_string(),
        name: session.name.clone(),
        cwd: session.cwd.display().to_string(),
        mode: "bypassPermissions".into(),
    })
}

#[tauri::command]
pub async fn send_user_message(
    manager: State<'_, Arc<SessionManager>>,
    id: Uuid,
    text: String,
) -> Result<(), String> {
    let session = manager.get(id).ok_or("no such session")?;
    session.send_user_text(&text).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cycle_mode(
    manager: State<'_, Arc<SessionManager>>,
    id: Uuid,
) -> Result<String, String> {
    let session = manager.get(id).ok_or("no such session")?;
    let current = session.mode.read().clone();
    let next = core_cycle_mode(current);
    session.set_mode(next.clone()).await.map_err(|e| e.to_string())?;
    Ok(next.as_cli().to_string())
}

#[tauri::command]
pub async fn interrupt(
    manager: State<'_, Arc<SessionManager>>,
    id: Uuid,
) -> Result<(), String> {
    let session = manager.get(id).ok_or("no such session")?;
    let payload = "{\"type\":\"control_request\",\"request\":{\"subtype\":\"interrupt\"}}\n".to_string();
    session.send_raw_line(payload).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sessions(manager: State<'_, Arc<SessionManager>>) -> Vec<SessionSummary> {
    manager.list().into_iter().map(|s| SessionSummary {
        id: s.id.to_string(),
        name: s.name.clone(),
        cwd: s.cwd.display().to_string(),
        mode: s.mode.read().as_cli().to_string(),
    }).collect()
}

#[tauri::command]
pub async fn close_session(
    manager: State<'_, Arc<SessionManager>>,
    id: Uuid,
) -> Result<(), String> {
    manager.close(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_agents() -> Vec<ccshell_core::agents::Agent> {
    let mut paths = vec![];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".claude/agents"));
    }
    paths.push(PathBuf::from(".claude/agents"));
    AgentRegistry::scan(&paths).agents().into_iter().cloned().collect()
}

#[tauri::command]
pub fn caffeinate_status(manager: State<'_, Arc<SessionManager>>) -> serde_json::Value {
    serde_json::json!({
        "active": manager.caffeinate_refcount() > 0,
        "refcount": manager.caffeinate_refcount(),
    })
}

fn which_claude() -> PathBuf {
    if let Ok(p) = std::env::var("CCSHELL_CLAUDE_BIN") {
        return PathBuf::from(p);
    }
    PathBuf::from("/Users/kushmodi/.local/bin/claude")
}
