use ccshell_core::session::{SubagentRecord, project_subagents, SessionEvent};

#[test]
fn start_then_stop_marks_complete() {
    let events = vec![
        SessionEvent::SubagentStart { id: "sa_1".into(), agent: "code-reviewer".into(), prompt: "p".into() },
        SessionEvent::SubagentStop  { id: "sa_1".into(), result: serde_json::json!({"summary":"ok"}) },
    ];
    let map = project_subagents(events.into_iter());
    let rec = map.get("sa_1").unwrap();
    assert_eq!(rec.agent, "code-reviewer");
    assert!(rec.completed);
}

#[test]
fn only_start_keeps_running() {
    let events = vec![
        SessionEvent::SubagentStart { id: "sa_2".into(), agent: "explore".into(), prompt: "p".into() },
    ];
    let map = project_subagents(events.into_iter());
    let rec = map.get("sa_2").unwrap();
    assert!(!rec.completed);
}
