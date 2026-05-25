use jetstream_app::state::{save_to, DirectoryConfig, Manifest, ManifestSession};
use jetstream_core::agents::AgentRegistry;
use jetstream_core::command_runner::{CommandEvent, CommandRunner};
use jetstream_core::manager::SessionManager;
use jetstream_core::session::{cycle_mode as core_cycle_mode, SessionConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub type CommandRunnerState = Mutex<Option<CommandRunner>>;

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub cwd: PathBuf,
    pub name: String,
    pub agent: Option<String>,
    pub resume_id: Option<Uuid>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
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
    let binary = which_claude();
    if !binary.exists() {
        return Err(format!(
            "claude binary not found at {}. Set CCSHELL_CLAUDE_BIN env var to your claude path.",
            binary.display()
        ));
    }
    let cwd = resolve_cwd(args.cwd)?;
    let (pref_model, pref_effort) = {
        let m = manifest.lock().unwrap();
        (m.model.clone(), m.effort.clone())
    };
    let cfg = SessionConfig {
        binary,
        cwd,
        name: args.name,
        agent: args.agent,
        resume_id: args.resume_id,
        model: args.model.or(pref_model),
        effort: args.effort.or(pref_effort),
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
    session
        .send_user_text(&text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cycle_mode(
    manager: State<'_, Arc<SessionManager>>,
    id: Uuid,
) -> Result<String, String> {
    let session = manager.get(id).ok_or("no such session")?;
    let current = session.mode.read().clone();
    let next = core_cycle_mode(current);
    session
        .set_mode(next.clone())
        .await
        .map_err(|e| e.to_string())?;
    Ok(next.as_cli().to_string())
}

#[tauri::command]
pub async fn interrupt(manager: State<'_, Arc<SessionManager>>, id: Uuid) -> Result<(), String> {
    let session = manager.get(id).ok_or("no such session")?;
    let payload =
        "{\"type\":\"control_request\",\"request\":{\"subtype\":\"interrupt\"}}\n".to_string();
    session
        .send_raw_line(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_sessions(manager: State<'_, Arc<SessionManager>>) -> Vec<SessionSummary> {
    manager
        .list()
        .into_iter()
        .map(|s| SessionSummary {
            id: s.id.to_string(),
            name: s.name.clone(),
            cwd: s.cwd.display().to_string(),
            mode: s.mode.read().as_cli().to_string(),
        })
        .collect()
}

#[tauri::command]
pub async fn switch_model(
    app: AppHandle,
    manager: State<'_, Arc<SessionManager>>,
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    id: Uuid,
    model: String,
) -> Result<SessionSummary, String> {
    let binary = which_claude();
    if !binary.exists() {
        return Err(format!("claude binary not found at {}", binary.display()));
    }
    let (name, cwd) = {
        let session = manager.get(id).ok_or("no such session")?;
        (session.name.clone(), session.cwd.clone())
    };
    let effort = {
        let m = manifest.lock().unwrap();
        m.effort.clone()
    };
    manager.close(id).await.map_err(|e| e.to_string())?;
    let cfg = SessionConfig {
        binary,
        cwd: cwd.clone(),
        name: name.clone(),
        agent: None,
        resume_id: Some(id),
        model: Some(model.clone()),
        effort,
    };
    let session = manager.spawn(cfg).await.map_err(|e| e.to_string())?;
    {
        let mut m = manifest.lock().unwrap();
        m.model = Some(model);
        let _ = save_to(&manifest_path, &m);
    }
    let new_id = session.id;
    let _ = app.emit(
        &format!("session://{new_id}"),
        &serde_json::json!({"type":"Resync"}),
    );
    let mut rx = session.subscribe();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Ok(ev) = rx.recv().await {
            let _ = app_clone.emit(&format!("session://{new_id}"), &ev);
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
pub fn rename_session(
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("name cannot be empty".into());
    }
    let mut m = manifest.lock().unwrap();
    if let Some(s) = m.sessions.iter_mut().find(|s| s.id == id) {
        s.name = trimmed;
    }
    save_to(&manifest_path, &m).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_cwd() -> String {
    dirs::home_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "/".into())
}

#[tauri::command]
pub fn list_sessions_for_cwd(
    manager: State<'_, Arc<SessionManager>>,
    manifest: State<'_, Mutex<Manifest>>,
    cwd: String,
) -> Vec<SessionSummary> {
    let target = canonicalize_cwd(&cwd);
    let active: Vec<SessionSummary> = manager
        .list()
        .into_iter()
        .filter(|s| canonicalize_cwd(&s.cwd.display().to_string()) == target)
        .map(|s| SessionSummary {
            id: s.id.to_string(),
            name: s.name.clone(),
            cwd: s.cwd.display().to_string(),
            mode: s.mode.read().as_cli().to_string(),
        })
        .collect();
    let active_ids: std::collections::HashSet<String> =
        active.iter().map(|s| s.id.clone()).collect();
    let m = manifest.lock().unwrap();
    let mut out = active;
    for s in &m.sessions {
        if canonicalize_cwd(&s.cwd) != target {
            continue;
        }
        if active_ids.contains(&s.id) {
            continue;
        }
        out.push(SessionSummary {
            id: s.id.clone(),
            name: s.name.clone(),
            cwd: s.cwd.clone(),
            mode: "bypassPermissions".into(),
        });
    }
    out
}

#[tauri::command]
pub fn get_last_cwd(manifest: State<'_, Mutex<Manifest>>) -> Option<String> {
    manifest.lock().unwrap().last_cwd.clone()
}

#[tauri::command]
pub fn set_last_cwd(
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    cwd: String,
) -> Result<(), String> {
    let mut m = manifest.lock().unwrap();
    m.last_cwd = Some(canonicalize_cwd(&cwd));
    save_to(&manifest_path, &m).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_directory_config(manifest: State<'_, Mutex<Manifest>>, cwd: String) -> DirectoryConfig {
    let m = manifest.lock().unwrap();
    m.directories.get(&cwd).cloned().unwrap_or_default()
}

#[tauri::command]
pub fn set_directory_config(
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    cwd: String,
    config: DirectoryConfig,
) -> Result<(), String> {
    let mut m = manifest.lock().unwrap();
    m.directories.insert(cwd, config);
    save_to(&manifest_path, &m).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Default)]
pub struct Preferences {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
}

#[tauri::command]
pub fn get_preferences(manifest: State<'_, Mutex<Manifest>>) -> Preferences {
    let m = manifest.lock().unwrap();
    Preferences {
        model: m.model.clone(),
        effort: m.effort.clone(),
    }
}

#[tauri::command]
pub fn set_preferences(
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    prefs: Preferences,
) -> Result<(), String> {
    let mut m = manifest.lock().unwrap();
    m.model = prefs.model;
    m.effort = prefs.effort;
    save_to(&manifest_path, &m).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    rx.await
        .ok()
        .flatten()
        .map(|f| canonicalize_cwd(&f.to_string()))
}

#[derive(Serialize)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub command: String,
}

fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if lines.len() <= n {
        return s.to_string();
    }
    lines[lines.len() - n..].join("\n")
}

#[tauri::command]
pub async fn run_directory_command(
    manifest: State<'_, Mutex<Manifest>>,
    cwd: String,
    kind: String,
) -> Result<CommandOutput, String> {
    let command = {
        let m = manifest.lock().unwrap();
        let cfg = m.directories.get(&cwd).cloned().unwrap_or_default();
        match kind.as_str() {
            "run" => cfg.run_command,
            "test" => cfg.test_command,
            "build" => cfg.build_command,
            _ => return Err(format!("unknown command kind: {kind}")),
        }
    };
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("no {kind} command configured for this directory"));
    }
    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.exists() {
        return Err(format!("cwd does not exist: {cwd}"));
    }
    let cmd_for_output = trimmed.clone();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = tokio::process::Command::new(&shell)
        .arg("-l")
        .arg("-c")
        .arg(&trimmed)
        .current_dir(&cwd_path)
        .output()
        .await
        .map_err(|e| format!("failed to spawn command: {e}"))?;
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(CommandOutput {
        exit_code,
        stdout_tail: tail_lines(&stdout, 15),
        stderr_tail: tail_lines(&stderr, 15),
        command: cmd_for_output,
    })
}

#[tauri::command]
pub async fn start_command(
    app: AppHandle,
    runner_state: State<'_, CommandRunnerState>,
    manifest: State<'_, Mutex<Manifest>>,
    cwd: String,
    kind: String,
) -> Result<String, String> {
    let command = {
        let m = manifest.lock().unwrap();
        let cfg = m.directories.get(&cwd).cloned().unwrap_or_default();
        match kind.as_str() {
            "run" => cfg.run_command,
            "test" => cfg.test_command,
            "build" => cfg.build_command,
            _ => return Err(format!("unknown command kind: {kind}")),
        }
    };
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("no {kind} command configured for this directory"));
    }
    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.exists() {
        return Err(format!("cwd does not exist: {cwd}"));
    }

    // Kill any existing runner
    {
        let mut guard = runner_state.lock().unwrap();
        if let Some(mut prev) = guard.take() {
            let _ = prev.kill();
        }
    }

    let runner =
        CommandRunner::spawn(&trimmed, &cwd_path, 80, 24).map_err(|e| e.to_string())?;
    let mut rx = runner.subscribe();

    {
        let mut guard = runner_state.lock().unwrap();
        *guard = Some(runner);
    }

    let cmd_for_event = trimmed.clone();
    tokio::spawn(async move {
        while let Ok(ev) = rx.recv().await {
            match ev {
                CommandEvent::Output(data) => {
                    let _ = app.emit("command://output", serde_json::json!({ "data": data }));
                }
                CommandEvent::Exit(code) => {
                    let _ = app.emit(
                        "command://exit",
                        serde_json::json!({
                            "exit_code": code,
                            "command": cmd_for_event,
                        }),
                    );
                    break;
                }
            }
        }
    });

    Ok(trimmed)
}

#[tauri::command]
pub fn send_command_input(
    runner_state: State<'_, CommandRunnerState>,
    data: String,
) -> Result<(), String> {
    let mut guard = runner_state.lock().unwrap();
    let runner = guard.as_mut().ok_or("no command running")?;
    runner
        .write_input(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_command(
    runner_state: State<'_, CommandRunnerState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = runner_state.lock().unwrap();
    let runner = guard.as_ref().ok_or("no command running")?;
    runner.resize(cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_command(runner_state: State<'_, CommandRunnerState>) -> Result<(), String> {
    let mut guard = runner_state.lock().unwrap();
    let runner = guard.as_mut().ok_or("no command running")?;
    runner.kill().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_command_buffer(runner_state: State<'_, CommandRunnerState>) -> Result<Vec<u8>, String> {
    let guard = runner_state.lock().unwrap();
    let runner = guard.as_ref().ok_or("no command running")?;
    Ok(runner.buffer_snapshot())
}

#[tauri::command]
pub fn list_agents() -> Vec<jetstream_core::agents::Agent> {
    let mut paths = vec![];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".claude/agents"));
        let plugins_root = home.join(".claude/plugins");
        collect_agent_dirs(&plugins_root, &mut paths, 0);
    }
    paths.push(PathBuf::from(".claude/agents"));
    AgentRegistry::scan(&paths)
        .agents()
        .into_iter()
        .cloned()
        .collect()
}

fn collect_agent_dirs(root: &std::path::Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        if p.file_name().and_then(|n| n.to_str()) == Some("agents") {
            out.push(p.clone());
            continue;
        }
        collect_agent_dirs(&p, out, depth + 1);
    }
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
    // The palette is a typing aid. Most commands are processed by the claude
    // CLI itself when sent as a stream-json user message — the CLI emits a
    // synthetic assistant reply with the real output. Only `/clear` and
    // `/model <name>` have client-side semantics (see slash-handlers.ts).
    vec![
        sc("clear", "Clear conversation (UI + claude context)", None),
        sc("context", "Show token usage breakdown", None),
        sc("cost", "Show session cost so far", None),
        sc("help", "Show claude CLI help", None),
        sc("status", "Show session status", None),
        sc("model", "Switch model for this session", Some("<name>")),
        sc("agents", "Manage subagents", None),
        sc("compact", "Summarize history to free context", None),
        sc("init", "Initialize CLAUDE.md", None),
        sc("mcp", "Manage MCP servers", None),
        sc("plugin", "Manage Claude Code plugins", None),
        sc("resume", "Resume a previous session", Some("[query]")),
        sc("review", "Review a pull request", Some("[pr]")),
        sc("memory", "Show or edit memory files", None),
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
    use jetstream_core::session::replay_jsonl;

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
    manifest: State<'_, Mutex<Manifest>>,
    args: ResumeArgs,
) -> Result<SessionSummary, String> {
    let (pref_model, pref_effort) = {
        let m = manifest.lock().unwrap();
        (m.model.clone(), m.effort.clone())
    };
    let cwd = resolve_cwd(PathBuf::from(args.cwd)).map_err(|e| e.to_string())?;
    let cfg = SessionConfig {
        binary: which_claude(),
        cwd,
        name: args.name,
        agent: None,
        resume_id: Some(args.id),
        model: pref_model,
        effort: pref_effort,
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
    // Try PATH first
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                return PathBuf::from(s);
            }
        }
    }
    // Fallbacks
    for candidate in [
        "/Users/kushmodi/.local/bin/claude",
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("claude")
}

fn resolve_cwd(input: PathBuf) -> Result<PathBuf, String> {
    let s = input.to_string_lossy();
    let candidate = if s.is_empty() || s == "." {
        dirs::home_dir().ok_or_else(|| "no home directory".to_string())?
    } else if let Some(stripped) = s.strip_prefix("~/") {
        dirs::home_dir()
            .ok_or_else(|| "no home directory".to_string())?
            .join(stripped)
    } else {
        input
    };
    candidate
        .canonicalize()
        .map_err(|_| format!("cwd does not exist: {}", candidate.display()))
}

fn canonicalize_cwd(cwd: &str) -> String {
    std::path::Path::new(cwd)
        .canonicalize()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| cwd.trim_end_matches('/').to_string())
}
