use crate::error::SessionError;
use crate::protocol::{parse_line, ContentBlock, StreamDelta, StreamJsonEvent, TextDelta, Usage};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

pub const EVENT_CHANNEL_CAP: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    BypassPermissions,
    Plan,
    AcceptEdits,
    Default,
}

impl PermissionMode {
    pub fn as_cli(&self) -> &'static str {
        match self {
            PermissionMode::BypassPermissions => "bypassPermissions",
            PermissionMode::Plan              => "plan",
            PermissionMode::AcceptEdits       => "acceptEdits",
            PermissionMode::Default           => "default",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionState { Idle, Thinking, Tool, Error, Closed }

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub name: String,
    pub agent: Option<String>,
    pub resume_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SessionEvent {
    Assistant     { msg_id: String, delta: String },
    Tool          { id: String, name: String, input: serde_json::Value },
    ToolResult    { id: String, output: serde_json::Value, is_error: bool },
    SubagentStart { id: String, agent: String, prompt: String },
    SubagentStop  { id: String, result: serde_json::Value },
    Hook          { event: String, payload: serde_json::Value },
    Result        { usage: Usage, cost_usd: f64 },
    Resync,
    Error         { message: String, recoverable: bool },
    Closed        { code: i32 },
}

pub struct Session {
    pub id: Uuid,
    pub name: String,
    pub cwd: PathBuf,
    pub mode: Arc<RwLock<PermissionMode>>,
    pub state: Arc<RwLock<SessionState>>,
    events_tx: broadcast::Sender<SessionEvent>,
    stdin_tx: mpsc::Sender<String>,
    _child: tokio::sync::Mutex<Option<Child>>,
}

impl Session {
    pub async fn spawn(cfg: SessionConfig) -> Result<Arc<Self>, SessionError> {
        let id = cfg.resume_id.unwrap_or_else(Uuid::new_v4);
        let mut cmd = Command::new(&cfg.binary);
        cmd.arg("-p")
           .arg("--output-format").arg("stream-json")
           .arg("--input-format").arg("stream-json")
           .arg("--include-partial-messages")
           .arg("--include-hook-events")
           .arg("--verbose")
           .arg("--dangerously-skip-permissions")
           .arg("--session-id").arg(id.to_string())
           .arg("--permission-mode").arg(PermissionMode::BypassPermissions.as_cli())
           .current_dir(&cfg.cwd)
           .stdin(Stdio::piped())
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        if let Some(agent) = &cfg.agent { cmd.arg("--agent").arg(agent); }
        if !cfg.name.is_empty()         { cmd.arg("--name").arg(&cfg.name); }
        if let Some(rid) = cfg.resume_id { cmd.arg("--resume").arg(rid.to_string()); }

        // Allow the test fake (a shell script) to run by stripping the flags it doesn't understand:
        // detection by filename — if the binary basename ends with `.sh`, drop all args.
        if cfg.binary.extension().and_then(|s| s.to_str()) == Some("sh") {
            cmd = Command::new(&cfg.binary);
            cmd.current_dir(&cfg.cwd)
               .stdin(Stdio::piped())
               .stdout(Stdio::piped())
               .stderr(Stdio::piped());
        }

        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => SessionError::NoBinary(cfg.binary.clone()),
            _ => SessionError::Io(e),
        })?;

        let stdout = child.stdout.take().expect("stdout piped");
        let stdin  = child.stdin.take().expect("stdin piped");

        let (events_tx, _) = broadcast::channel(EVENT_CHANNEL_CAP);
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(256);

        // Writer task
        tokio::spawn({
            let mut stdin = stdin;
            async move {
                while let Some(line) = stdin_rx.recv().await {
                    if stdin.write_all(line.as_bytes()).await.is_err() { break; }
                    if !line.ends_with('\n')
                        && stdin.write_all(b"\n").await.is_err() { break; }
                    let _ = stdin.flush().await;
                }
            }
        });

        // Reader task
        tokio::spawn({
            let tx = events_tx.clone();
            async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.is_empty() { continue; }
                    match parse_line(&line) {
                        Ok(evt) => {
                            for e in map_event(evt) {
                                if tx.send(e).is_err() { return; }
                            }
                        }
                        Err(err) => {
                            let _ = tx.send(SessionEvent::Error {
                                message: format!("parse: {err}"),
                                recoverable: true,
                            });
                        }
                    }
                }
                let _ = tx.send(SessionEvent::Closed { code: 0 });
            }
        });

        Ok(Arc::new(Self {
            id,
            name: cfg.name,
            cwd: cfg.cwd,
            mode: Arc::new(RwLock::new(PermissionMode::BypassPermissions)),
            state: Arc::new(RwLock::new(SessionState::Idle)),
            events_tx,
            stdin_tx,
            _child: tokio::sync::Mutex::new(Some(child)),
        }))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.events_tx.subscribe()
    }

    pub async fn send_user_text(&self, text: &str) -> Result<(), SessionError> {
        let payload = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": text }
        });
        self.stdin_tx.send(format!("{payload}\n")).await
            .map_err(|_| SessionError::UnexpectedExit(0))?;
        Ok(())
    }
}

fn map_event(evt: StreamJsonEvent) -> Vec<SessionEvent> {
    match evt {
        StreamJsonEvent::Assistant { message } => {
            let mut out = vec![];
            for block in message.content {
                if let ContentBlock::ToolUse { id, name, input } = block {
                    out.push(SessionEvent::Tool { id, name, input });
                }
            }
            out
        }
        StreamJsonEvent::User { message } => {
            let mut out = vec![];
            for block in message.content {
                if let ContentBlock::ToolResult { tool_use_id, content, is_error } = block {
                    out.push(SessionEvent::ToolResult { id: tool_use_id, output: content, is_error });
                }
            }
            out
        }
        StreamJsonEvent::StreamEvent { event, parent_message_id, .. } => {
            if let StreamDelta::ContentBlockDelta { delta: TextDelta::TextDelta { text }, .. } = event {
                if let Some(msg_id) = parent_message_id {
                    return vec![SessionEvent::Assistant { msg_id, delta: text }];
                }
            }
            vec![]
        }
        StreamJsonEvent::Hook { hook_event_name, payload } => {
            match hook_event_name.as_str() {
                "SubagentStart" => {
                    let id     = payload.get("subagent_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let agent  = payload.get("agent_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let prompt = payload.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    vec![SessionEvent::SubagentStart { id, agent, prompt }]
                }
                "SubagentStop" => {
                    let id     = payload.get("subagent_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let result = payload.get("result").cloned().unwrap_or(serde_json::Value::Null);
                    vec![SessionEvent::SubagentStop { id, result }]
                }
                _ => vec![SessionEvent::Hook { event: hook_event_name, payload }],
            }
        }
        StreamJsonEvent::Result { usage, total_cost_usd, .. } =>
            vec![SessionEvent::Result { usage, cost_usd: total_cost_usd }],
        _ => vec![],
    }
}
