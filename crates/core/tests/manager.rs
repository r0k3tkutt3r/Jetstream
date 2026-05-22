use ccshell_core::manager::SessionManager;
use ccshell_core::session::SessionConfig;
use std::path::PathBuf;

fn fake_claude() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fakes/fake_claude.sh")
}

#[tokio::test]
async fn caffeinate_refcount_matches_session_count() {
    let mgr = SessionManager::new_with_caffeinate_binary("/usr/bin/yes".into());
    assert_eq!(mgr.caffeinate_refcount(), 0);

    let s1 = mgr.spawn(SessionConfig {
        binary: fake_claude(), cwd: std::env::temp_dir(),
        name: "a".into(), agent: None, resume_id: None,
    }).await.unwrap();
    assert_eq!(mgr.caffeinate_refcount(), 1);

    let s2 = mgr.spawn(SessionConfig {
        binary: fake_claude(), cwd: std::env::temp_dir(),
        name: "b".into(), agent: None, resume_id: None,
    }).await.unwrap();
    assert_eq!(mgr.caffeinate_refcount(), 2);

    mgr.close(s1.id).await.unwrap();
    assert_eq!(mgr.caffeinate_refcount(), 1);
    mgr.close(s2.id).await.unwrap();
    assert_eq!(mgr.caffeinate_refcount(), 0);
}
