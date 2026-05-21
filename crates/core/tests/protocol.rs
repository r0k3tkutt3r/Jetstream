use ccshell_core::protocol::{StreamJsonEvent, parse_line};
use std::path::PathBuf;

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/stream_json")
        .join(name);
    std::fs::read_to_string(path).expect("fixture not found")
}

#[test]
fn parses_assistant_delta_lines() {
    for line in fixture("assistant_delta.jsonl").lines() {
        let evt = parse_line(line).expect("parse");
        match evt {
            StreamJsonEvent::System { .. }
            | StreamJsonEvent::Assistant { .. }
            | StreamJsonEvent::StreamEvent { .. } => {}
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}

#[test]
fn parses_tool_use_and_result() {
    let mut seen_tool_use = false;
    let mut seen_tool_result = false;
    for line in fixture("tool_use.jsonl").lines() {
        match parse_line(line).expect("parse") {
            StreamJsonEvent::Assistant { message }
                if message.content.iter().any(|b| matches!(b, ccshell_core::protocol::ContentBlock::ToolUse { .. })) => {
                seen_tool_use = true;
            }
            StreamJsonEvent::User { message }
                if message.content.iter().any(|b| matches!(b, ccshell_core::protocol::ContentBlock::ToolResult { .. })) => {
                seen_tool_result = true;
            }
            _ => {}
        }
    }
    assert!(seen_tool_use, "expected a tool_use block");
    assert!(seen_tool_result, "expected a tool_result block");
}

#[test]
fn parses_subagent_hook_events() {
    let content = fixture("subagent_start.jsonl");
    let lines: Vec<_> = content.lines().collect();
    let start = parse_line(lines[0]).expect("parse start");
    let stop  = parse_line(lines[1]).expect("parse stop");
    assert!(matches!(start, StreamJsonEvent::Hook { ref hook_event_name, .. } if hook_event_name == "SubagentStart"));
    assert!(matches!(stop,  StreamJsonEvent::Hook { ref hook_event_name, .. } if hook_event_name == "SubagentStop"));
}

#[test]
fn parses_result_event() {
    let line = fixture("result.jsonl");
    let evt = parse_line(line.trim()).expect("parse");
    let StreamJsonEvent::Result { total_cost_usd, usage, .. } = evt else {
        panic!("expected Result");
    };
    assert!((total_cost_usd - 0.018).abs() < 1e-9);
    assert_eq!(usage.input_tokens, 120);
    assert_eq!(usage.output_tokens, 48);
}

#[test]
fn unknown_variants_become_unknown_not_error() {
    let line = r#"{"type":"future_variant_we_dont_know_yet","foo":"bar"}"#;
    let evt = parse_line(line).expect("parse should succeed");
    assert!(matches!(evt, StreamJsonEvent::Unknown));
}
