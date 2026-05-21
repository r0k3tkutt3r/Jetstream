use ccshell_core::SessionError;
use std::path::PathBuf;
use std::time::Duration;

#[test]
fn variants_format_human_readable() {
    let cases: Vec<(SessionError, &str)> = vec![
        (SessionError::NoBinary(PathBuf::from("/nope/claude")), "claude binary not found at /nope/claude"),
        (SessionError::UnexpectedExit(137), "claude exited unexpectedly: code 137"),
        (SessionError::ControlTimeout(Duration::from_millis(500)), "control request timed out after 500ms"),
        (SessionError::Lagged, "ipc channel lagged; client must resync"),
    ];
    for (err, msg) in cases {
        assert_eq!(err.to_string(), msg, "wrong Display for variant");
    }
}

#[test]
fn parse_error_carries_line_and_source() {
    let bogus = "{ not json";
    let parse: serde_json::Error = serde_json::from_str::<serde_json::Value>(bogus).unwrap_err();
    let e = SessionError::ParseError { line: 42, source: parse };
    assert!(e.to_string().contains("line 42"));
}

#[test]
fn io_error_converts_via_from() {
    let io = std::io::Error::new(std::io::ErrorKind::NotFound, "x");
    let e: SessionError = io.into();
    assert!(matches!(e, SessionError::Io(_)));
}
