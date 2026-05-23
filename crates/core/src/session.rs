use crate::caffeinate::CaffeinateCtl;
use crate::error::SessionError;
use crate::protocol::{parse_line, ContentBlock, StreamDelta, StreamJsonEvent, TextDelta, Usage};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc};
use tracing::{info_span, Instrument};
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
            PermissionMode::Plan => "plan",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Default => "default",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionState {
    Idle,
    Thinking,
    Tool,
    Error,
    Closed,
}

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub name: String,
    pub agent: Option<String>,
    pub resume_id: Option<Uuid>,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SessionEvent {
    Assistant {
        msg_id: String,
        delta: String,
        #[serde(default)]
        is_final: bool,
    },
    Tool {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        id: String,
        output: serde_json::Value,
        is_error: bool,
    },
    SubagentStart {
        id: String,
        agent: String,
        prompt: String,
    },
    SubagentStop {
        id: String,
        result: serde_json::Value,
    },
    Hook {
        event: String,
        payload: serde_json::Value,
    },
    Result {
        usage: Usage,
        cost_usd: f64,
    },
    /// Mid-turn usage update extracted from streaming MessageStart/MessageDelta
    /// events. Used for the live token counter in the activity indicator —
    /// `input_tokens` is shown with ↓ during the "loading" phase; once output
    /// streams arrive, `output_tokens` is shown with ↑.
    TurnUpdate {
        #[serde(default)]
        input_tokens: u64,
        #[serde(default)]
        output_tokens: u64,
    },
    Resync,
    Error {
        message: String,
        recoverable: bool,
    },
    Closed {
        code: i32,
    },
}

pub struct Session {
    pub id: Uuid,
    pub name: String,
    pub cwd: PathBuf,
    pub mode: Arc<RwLock<PermissionMode>>,
    pub state: Arc<RwLock<SessionState>>,
    events_tx: broadcast::Sender<SessionEvent>,
    stdin_tx: mpsc::Sender<String>,
    is_busy: Arc<AtomicBool>,
}

impl Session {
    pub async fn spawn(cfg: SessionConfig) -> Result<Arc<Self>, SessionError> {
        Self::spawn_with(cfg, None).await
    }

    pub async fn spawn_with(
        cfg: SessionConfig,
        caffeinate: Option<Arc<CaffeinateCtl>>,
    ) -> Result<Arc<Self>, SessionError> {
        let id = cfg.resume_id.unwrap_or_else(Uuid::new_v4);
        let mut cmd = Command::new(&cfg.binary);
        cmd.arg("-p")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--include-partial-messages")
            .arg("--include-hook-events")
            .arg("--verbose")
            .arg("--dangerously-skip-permissions")
            .arg("--permission-mode")
            .arg(PermissionMode::BypassPermissions.as_cli())
            .current_dir(&cfg.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // `--session-id` and `--resume` are mutually exclusive in the claude
        // CLI (unless `--fork-session` is also passed, which would change the
        // id and break the frontend's event channel). Pass `--session-id` only
        // when starting fresh; let `--resume` adopt the existing id.
        if cfg.resume_id.is_none() {
            cmd.arg("--session-id").arg(id.to_string());
        }

        if let Some(agent) = &cfg.agent {
            cmd.arg("--agent").arg(agent);
        }
        if !cfg.name.is_empty() {
            cmd.arg("--name").arg(&cfg.name);
        }
        if let Some(rid) = cfg.resume_id {
            cmd.arg("--resume").arg(rid.to_string());
        }
        if let Some(model) = &cfg.model {
            if !model.is_empty() {
                cmd.arg("--model").arg(model);
            }
        }
        if let Some(effort) = &cfg.effort {
            if !effort.is_empty() {
                cmd.arg("--effort").arg(effort);
            }
        }

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
        let stdin = child.stdin.take().expect("stdin piped");
        let stderr = child.stderr.take().expect("stderr piped");

        // Drain stderr so the child never blocks on a full pipe buffer.
        // Without this, --verbose / hook chatter can wedge the entire session
        // once the kernel pipe (~64 KB on macOS) fills.
        tokio::spawn({
            let stderr_span = info_span!("session.stderr", session_id = %id);
            async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target: "ccshell::claude_stderr", "{line}");
                }
            }
            .instrument(stderr_span)
        });

        let (events_tx, _) = broadcast::channel(EVENT_CHANNEL_CAP);
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(256);

        // Raw mpsc channel — reader → coalescer
        let (raw_tx, raw_rx) = mpsc::channel::<SessionEvent>(256);
        let (coalesced_tx, mut coalesced_rx) = mpsc::channel::<SessionEvent>(256);

        // Busy tracker: subscribe BEFORE the bridge starts forwarding, so we
        // never miss an event. Acquires caffeinate on the first activity
        // event of a turn and releases on Result/Error/Closed.
        let is_busy = Arc::new(AtomicBool::new(false));
        if let Some(caf) = caffeinate {
            let busy = is_busy.clone();
            let mut tracker_rx = events_tx.subscribe();
            tokio::spawn(async move {
                loop {
                    let ev = match tracker_rx.recv().await {
                        Ok(ev) => ev,
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    };
                    let activity = matches!(
                        ev,
                        SessionEvent::Assistant { .. }
                            | SessionEvent::Tool { .. }
                            | SessionEvent::ToolResult { .. }
                    );
                    let terminal = matches!(
                        ev,
                        SessionEvent::Result { .. }
                            | SessionEvent::Error { .. }
                            | SessionEvent::Closed { .. }
                    );
                    if activity && !busy.swap(true, Ordering::SeqCst) {
                        caf.acquire();
                    } else if terminal && busy.swap(false, Ordering::SeqCst) {
                        caf.release();
                    }
                }
                if busy.swap(false, Ordering::SeqCst) {
                    caf.release();
                }
            });
        }

        // Coalescer: merges Assistant deltas at 16 ms ticks, passes through everything else
        tokio::spawn(coalesce_deltas(
            raw_rx,
            coalesced_tx,
            std::time::Duration::from_millis(16),
        ));

        // Bridge: mpsc → broadcast (ignore send errors — no receivers is fine)
        tokio::spawn({
            let bcast = events_tx.clone();
            async move {
                while let Some(ev) = coalesced_rx.recv().await {
                    let _ = bcast.send(ev);
                }
            }
        });

        // Writer task
        tokio::spawn({
            let mut stdin = stdin;
            async move {
                while let Some(line) = stdin_rx.recv().await {
                    if stdin.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                    if !line.ends_with('\n') && stdin.write_all(b"\n").await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
            }
        });

        // Reader task — owns `child` so it can capture the real exit code
        tokio::spawn({
            let reader_loop = async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.is_empty() {
                        continue;
                    }
                    match parse_line(&line) {
                        Ok(evt) => {
                            for e in map_event(evt) {
                                if raw_tx.send(e).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Err(err) => {
                            let _ = raw_tx
                                .send(SessionEvent::Error {
                                    message: format!("parse: {err}"),
                                    recoverable: true,
                                })
                                .await;
                        }
                    }
                }
                let code = match child.wait().await {
                    Ok(status) => status.code().unwrap_or(0),
                    Err(_) => -1,
                };
                let _ = raw_tx.send(SessionEvent::Closed { code }).await;
            };
            reader_loop.instrument(info_span!("session.reader", session_id = %id))
        });

        Ok(Arc::new(Self {
            id,
            name: cfg.name,
            cwd: cfg.cwd,
            mode: Arc::new(RwLock::new(PermissionMode::BypassPermissions)),
            state: Arc::new(RwLock::new(SessionState::Idle)),
            events_tx,
            stdin_tx,
            is_busy,
        }))
    }

    /// Test-visible accessor for the current busy state.
    pub fn is_busy(&self) -> bool {
        self.is_busy.load(Ordering::SeqCst)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.events_tx.subscribe()
    }

    pub async fn send_user_text(&self, text: &str) -> Result<(), SessionError> {
        let payload = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": text }
        });
        self.stdin_tx
            .send(format!("{payload}\n"))
            .await
            .map_err(|_| SessionError::UnexpectedExit(0))?;
        Ok(())
    }

    pub async fn set_mode(&self, mode: PermissionMode) -> Result<(), SessionError> {
        let line = render_mode_control(mode.clone());
        self.stdin_tx
            .send(line)
            .await
            .map_err(|_| SessionError::UnexpectedExit(0))?;
        *self.mode.write() = mode;
        Ok(())
    }

    pub async fn send_raw_line(&self, line: String) -> Result<(), SessionError> {
        self.stdin_tx
            .send(line)
            .await
            .map_err(|_| SessionError::UnexpectedExit(0))?;
        Ok(())
    }
}

/// Parse a JSONL transcript file and yield the same SessionEvents the live
/// reader produces. Errors are best-effort — bad lines are skipped.
pub async fn replay_jsonl(
    path: &std::path::Path,
    tx: tokio::sync::mpsc::Sender<SessionEvent>,
) -> std::io::Result<()> {
    let file = tokio::fs::File::open(path).await?;
    let reader = tokio::io::BufReader::new(file);
    let mut lines = tokio::io::AsyncBufReadExt::lines(reader);
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(evt) = parse_line(&line) {
            for e in map_event(evt) {
                if tx.send(e).await.is_err() {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

use std::collections::{BTreeMap, HashMap};
use tokio::time::interval;

#[derive(Debug, Clone, Serialize)]
pub struct SubagentRecord {
    pub id: String,
    pub agent: String,
    pub prompt: String,
    pub completed: bool,
    pub result: Option<serde_json::Value>,
}

pub fn project_subagents<I: IntoIterator<Item = SessionEvent>>(
    iter: I,
) -> BTreeMap<String, SubagentRecord> {
    let mut map = BTreeMap::new();
    for ev in iter {
        match ev {
            SessionEvent::SubagentStart { id, agent, prompt } => {
                map.insert(
                    id.clone(),
                    SubagentRecord {
                        id,
                        agent,
                        prompt,
                        completed: false,
                        result: None,
                    },
                );
            }
            SessionEvent::SubagentStop { id, result } => {
                if let Some(rec) = map.get_mut(&id) {
                    rec.completed = true;
                    rec.result = Some(result);
                }
            }
            _ => {}
        }
    }
    map
}

/// Merges Assistant text deltas keyed by msg_id, flushing at most every `tick`.
/// Pass-through for all other variants.
pub async fn coalesce_deltas(
    mut rx: mpsc::Receiver<SessionEvent>,
    tx: mpsc::Sender<SessionEvent>,
    tick: std::time::Duration,
) {
    let mut pending: HashMap<String, String> = HashMap::new();
    let mut tick = interval(tick);
    loop {
        tokio::select! {
            biased;
            maybe = rx.recv() => match maybe {
                Some(SessionEvent::Assistant { msg_id, delta, is_final: false }) => {
                    pending.entry(msg_id).or_default().push_str(&delta);
                }
                Some(other) => {
                    // Flush any buffered deltas before forwarding non-Assistant events,
                    // so that ordering is preserved (Assistant before Result, etc.)
                    for (msg_id, delta) in pending.drain() {
                        let _ = tx.send(SessionEvent::Assistant { msg_id, delta, is_final: false }).await;
                    }
                    let _ = tx.send(other).await;
                }
                None => {
                    for (msg_id, delta) in pending.drain() {
                        let _ = tx.send(SessionEvent::Assistant { msg_id, delta, is_final: false }).await;
                    }
                    return;
                }
            },
            _ = tick.tick() => {
                for (msg_id, delta) in pending.drain() {
                    let _ = tx.send(SessionEvent::Assistant { msg_id, delta, is_final: false }).await;
                }
            }
        }
    }
}

pub fn cycle_mode(current: PermissionMode) -> PermissionMode {
    match current {
        PermissionMode::BypassPermissions => PermissionMode::Plan,
        PermissionMode::Plan => PermissionMode::AcceptEdits,
        PermissionMode::AcceptEdits => PermissionMode::BypassPermissions,
        PermissionMode::Default => PermissionMode::BypassPermissions,
    }
}

pub fn render_mode_control(mode: PermissionMode) -> String {
    let v = serde_json::json!({
        "type": "control_request",
        "request": { "subtype": "set_permission_mode", "mode": mode.as_cli() }
    });
    format!("{v}\n")
}

#[derive(Debug, Clone, Copy)]
pub enum ModeStrategy {
    ControlRequest,
    Respawn,
}

fn map_event(evt: StreamJsonEvent) -> Vec<SessionEvent> {
    match evt {
        StreamJsonEvent::Assistant { message } => {
            let mut out = vec![];
            let mut text_buf = String::new();
            for block in message.content {
                match block {
                    ContentBlock::Text { text } => text_buf.push_str(&text),
                    ContentBlock::ToolUse { id, name, input } => {
                        out.push(SessionEvent::Tool { id, name, input });
                    }
                    _ => {}
                }
            }
            if !text_buf.is_empty() {
                out.insert(
                    0,
                    SessionEvent::Assistant {
                        msg_id: message.id,
                        delta: text_buf,
                        is_final: true,
                    },
                );
            }
            out
        }
        StreamJsonEvent::User { message } => {
            let mut out = vec![];
            for block in message.content {
                if let ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } = block
                {
                    out.push(SessionEvent::ToolResult {
                        id: tool_use_id,
                        output: content,
                        is_error,
                    });
                }
            }
            out
        }
        StreamJsonEvent::StreamEvent {
            event,
            parent_message_id,
            ..
        } => match event {
            StreamDelta::ContentBlockDelta {
                delta: TextDelta::TextDelta { text },
                ..
            } => {
                if let Some(msg_id) = parent_message_id {
                    vec![SessionEvent::Assistant {
                        msg_id,
                        delta: text,
                        is_final: false,
                    }]
                } else {
                    vec![]
                }
            }
            StreamDelta::MessageStart { message } => {
                if let Some(u) = message.usage {
                    vec![SessionEvent::TurnUpdate {
                        input_tokens: u.input_tokens
                            + u.cache_read_input_tokens
                            + u.cache_creation_input_tokens,
                        output_tokens: 0,
                    }]
                } else {
                    vec![]
                }
            }
            StreamDelta::MessageDelta {
                usage: Some(u), ..
            } => vec![SessionEvent::TurnUpdate {
                input_tokens: 0,
                output_tokens: u.output_tokens,
            }],
            _ => vec![],
        },
        StreamJsonEvent::Hook {
            hook_event_name,
            payload,
        } => match hook_event_name.as_str() {
            "SubagentStart" => {
                let id = payload
                    .get("subagent_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let agent = payload
                    .get("agent_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let prompt = payload
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                vec![SessionEvent::SubagentStart { id, agent, prompt }]
            }
            "SubagentStop" => {
                let id = payload
                    .get("subagent_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let result = payload
                    .get("result")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                vec![SessionEvent::SubagentStop { id, result }]
            }
            _ => vec![SessionEvent::Hook {
                event: hook_event_name,
                payload,
            }],
        },
        StreamJsonEvent::Result {
            usage,
            total_cost_usd,
            ..
        } => vec![SessionEvent::Result {
            usage,
            cost_usd: total_cost_usd,
        }],
        _ => vec![],
    }
}
