use ccshell_core::session::{replay_jsonl, SessionEvent};
use std::path::PathBuf;
use tokio::sync::mpsc;

#[tokio::test]
async fn replay_emits_events_from_fixture() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/stream_json/assistant_delta.jsonl");
    let (tx, mut rx) = mpsc::channel::<SessionEvent>(64);
    tokio::spawn(async move {
        let _ = replay_jsonl(&path, tx).await;
    });
    let mut count = 0;
    while let Some(_ev) = rx.recv().await {
        count += 1;
    }
    assert!(count > 0, "expected at least one event from replay");
}
