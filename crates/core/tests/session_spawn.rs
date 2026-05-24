use jetstream_core::session::{Session, SessionConfig, SessionEvent};
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

fn fake_claude() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fakes/fake_claude.sh")
}

#[tokio::test]
async fn spawns_and_emits_events_until_result() {
    let cfg = SessionConfig {
        binary: fake_claude(),
        cwd: std::env::temp_dir(),
        name: "test".into(),
        agent: None,
        resume_id: None,
        model: None,
        effort: None,
    };
    let session = Session::spawn(cfg).await.expect("spawn");
    let mut rx = session.subscribe();

    let mut saw_assistant = false;
    let mut saw_result = false;
    for _ in 0..20 {
        let ev = timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("event timeout")
            .expect("recv");
        match ev {
            SessionEvent::Assistant { .. } => saw_assistant = true,
            SessionEvent::Result { .. } => {
                saw_result = true;
                break;
            }
            _ => {}
        }
    }
    assert!(saw_assistant, "expected at least one Assistant event");
    assert!(saw_result, "expected a Result event");
}
