use ccshell_app::state::{Manifest, ManifestSession, save_to};
use ccshell_core::agents::AgentRegistry;
use ccshell_core::manager::SessionManager;
use ccshell_core::session::{SessionConfig, cycle_mode as core_cycle_mode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
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
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
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

    {
        let mut m = manifest.lock().unwrap();
        m.sessions.push(ManifestSession {
            id: session.id.to_string(),
            cwd: session.cwd.display().to_string(),
            name: session.name.clone(),
            created: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
        let _ = save_to(&manifest_path, &m);
    }

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
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    id: Uuid,
) -> Result<(), String> {
    manager.close(id).await.map_err(|e| e.to_string())?;

    {
        let mut m = manifest.lock().unwrap();
        m.sessions.retain(|s| s.id != id.to_string());
        let _ = save_to(&manifest_path, &m);
    }

    Ok(())
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

#[derive(serde::Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
}

#[tauri::command]
pub fn list_slash_commands() -> Vec<SlashCommand> {
    vec![
        sc("agents",  "Manage subagents",                  None),
        sc("clear",   "Clear conversation history",        None),
        sc("compact", "Summarize history to free context", None),
        sc("model",   "Switch model for this session",     Some("<model>")),
        sc("mcp",     "Manage MCP servers",                None),
        sc("plugin",  "Manage Claude Code plugins",        None),
        sc("resume",  "Resume a previous session",         Some("[query]")),
        sc("help",    "Show help",                         None),
        sc("init",    "Initialize CLAUDE.md",              None),
        sc("review",  "Review a pull request",             Some("[pr]")),
    ]
}

fn sc(name: &str, desc: &str, hint: Option<&str>) -> SlashCommand {
    SlashCommand {
        name: name.into(),
        description: desc.into(),
        argument_hint: hint.map(|s| s.into()),
    }
}

#[tauri::command]
pub async fn replay_session(
    app: AppHandle,
    manifest: State<'_, std::sync::Mutex<Manifest>>,
    id: Uuid,
) -> Result<(), String> {
    use ccshell_core::session::replay_jsonl;

    let session = {
        let manifest_guard = manifest.lock().unwrap();
        manifest_guard
            .sessions
            .iter()
            .find(|s| s.id == id.to_string())
            .ok_or("no such session in manifest")?
            .clone()
    };

    let encoded_cwd = session.cwd.replace('/', "-");
    let path = dirs::home_dir()
        .ok_or("no home dir")?
        .join(format!(".claude/projects/{encoded_cwd}/{id}.jsonl"));

    let (tx, mut rx) = tokio::sync::mpsc::channel(256);
    tokio::spawn(async move {
        let _ = replay_jsonl(&path, tx).await;
    });

    let app_clone = app.clone();
    let topic = format!("session://{id}");
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let _ = app_clone.emit(&topic, &ev);
        }
    });

    Ok(())
}

#[derive(Deserialize)]
pub struct ResumeArgs {
    pub id: Uuid,
    pub cwd: String,
    pub name: String,
}

#[tauri::command]
pub async fn resume_session(
    app: AppHandle,
    manager: State<'_, Arc<SessionManager>>,
    args: ResumeArgs,
) -> Result<SessionSummary, String> {
    let cfg = SessionConfig {
        binary: which_claude(),
        cwd: PathBuf::from(args.cwd),
        name: args.name,
        agent: None,
        resume_id: Some(args.id),
    };
    let session = manager.spawn(cfg).await.map_err(|e| e.to_string())?;
    let id = session.id;
    let mut rx = session.subscribe();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Ok(ev) = rx.recv().await {
            let _ = app_clone.emit(&format!("session://{id}"), &ev);
        }
    });
    let mode = session.mode.read().as_cli().to_string();
    Ok(SessionSummary {
        id: session.id.to_string(),
        name: session.name.clone(),
        cwd: session.cwd.display().to_string(),
        mode,
    })
}

fn which_claude() -> PathBuf {
    if let Ok(p) = std::env::var("CCSHELL_CLAUDE_BIN") {
        return PathBuf::from(p);
    }
    PathBuf::from("/Users/kushmodi/.local/bin/claude")
}
