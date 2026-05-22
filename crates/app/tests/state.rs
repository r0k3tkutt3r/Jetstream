use ccshell_app::state::{load_from, save_to, Manifest, ManifestSession};
use tempfile::tempdir;

#[test]
fn roundtrip_preserves_sessions_and_window() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let m = Manifest {
        sessions: vec![ManifestSession {
            id: "abc".into(),
            cwd: "/tmp".into(),
            name: "x".into(),
            created: 1716240000,
        }],
        window: Default::default(),
        theme: "dark".into(),
        font_family: "JetBrains Mono".into(),
        font_size: 13,
    };

    save_to(&path, &m).unwrap();
    let loaded = load_from(&path).unwrap();
    assert_eq!(loaded.sessions.len(), 1);
    assert_eq!(loaded.sessions[0].name, "x");
    assert_eq!(loaded.theme, "dark");
}

#[test]
fn missing_file_returns_default() {
    let dir = tempdir().unwrap();
    let loaded = load_from(&dir.path().join("none.json")).unwrap();
    assert!(loaded.sessions.is_empty());
}
