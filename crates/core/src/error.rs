use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("claude binary not found at {}", .0.display())]
    NoBinary(PathBuf),

    #[error("claude exited unexpectedly: code {0}")]
    UnexpectedExit(i32),

    #[error("stream-json parse failure on line {line}: {source}")]
    ParseError { line: u64, #[source] source: serde_json::Error },

    #[error("control request timed out after {:?}", .0)]
    ControlTimeout(Duration),

    #[error("ipc channel lagged; client must resync")]
    Lagged,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("control response error: {0}")]
    ControlResponse(String),
}
