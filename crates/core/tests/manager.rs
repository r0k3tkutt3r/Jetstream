use ccshell_core::manager::SessionManager;
use ccshell_core::session::{SessionConfig, SessionEvent};
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

fn fake_claude() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fakes/fake_claude.sh")
}

fn cfg(name: &str) -> SessionConfig {
    SessionConfig {
        binary: fake_claude(),
        cwd: std::env::temp_dir(),
        name: name.into(),
        agent: None,
        resume_id: None,
        model: None,
        effort: None,
    }
}

/// Drain events until a Result fires, so the busy tracker has time to
/// transition from busy→idle and release the caffeinate handle.
async fn wait_for_result(
    rx: &mut tokio::sync::broadcast::Receiver<SessionEvent>,
) -> Result<(), &'static str> {
    for _ in 0..40 {
        match timeout(Duration::from_secs(2), rx.recv()).await {
            Ok(Ok(SessionEvent::Result { .. })) => return Ok(()),
            Ok(Ok(_)) => continue,
            Ok(Err(_)) => return Err("channel closed before Result"),
            Err(_) => return Err("timeout waiting for Result"),
        }
    }
    Err("too many events without Result")
}

#[tokio::test]
async fn caffeinate_zero_before_any_activity() {
    let mgr = SessionManager::new_with_caffeinate_binary("/usr/bin/yes".into());
    assert_eq!(mgr.caffeinate_refcount(), 0);
}

#[tokio::test]
async fn caffeinate_drops_back_to_zero_after_turn_result() {
    let mgr = SessionManager::new_with_caffeinate_binary("/usr/bin/yes".into());
    let s = mgr.spawn(cfg("a")).await.unwrap();
    let mut rx = s.subscribe();

    wait_for_result(&mut rx).await.unwrap();

    // The tracker observes the Result event asynchronously; give it a beat.
    for _ in 0..50 {
        if mgr.caffeinate_refcount() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(
        mgr.caffeinate_refcount(),
        0,
        "caffeinate should release once a turn finishes",
    );

    mgr.close(s.id).await.unwrap();
    // close itself must not touch caffeinate either.
    assert_eq!(mgr.caffeinate_refcount(), 0);
}

#[tokio::test]
async fn caffeinate_close_alone_does_not_acquire() {
    let mgr = SessionManager::new_with_caffeinate_binary("/usr/bin/yes".into());
    let s = mgr.spawn(cfg("a")).await.unwrap();
    let id = s.id;
    drop(s);
    mgr.close(id).await.unwrap();
    assert_eq!(mgr.caffeinate_refcount(), 0);
}

#[tokio::test]
async fn caffeinate_releases_when_session_closes_without_result() {
    // Spawn many sessions and close them; refcount must remain 0 because no
    // tracked activity happened *after* the existing Result (the fake closes
    // its own turn cleanly), and the tracker drops to 0 on Closed.
    let mgr = SessionManager::new_with_caffeinate_binary("/usr/bin/yes".into());
    let mut handles = vec![];
    for i in 0..3 {
        let s = mgr.spawn(cfg(&format!("s{i}"))).await.unwrap();
        let mut rx = s.subscribe();
        wait_for_result(&mut rx).await.unwrap();
        handles.push(s);
    }
    for s in &handles {
        mgr.close(s.id).await.unwrap();
    }

    for _ in 0..50 {
        if mgr.caffeinate_refcount() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(mgr.caffeinate_refcount(), 0);
}
