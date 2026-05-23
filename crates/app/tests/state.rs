use ccshell_app::state::{load_from, save_to, DirectoryConfig, Manifest, ManifestSession};
use std::collections::HashMap;
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
        last_cwd: None,
        directories: HashMap::new(),
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
    assert!(loaded.last_cwd.is_none());
    assert!(loaded.directories.is_empty());
}

#[test]
fn roundtrip_preserves_last_cwd_and_directories() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");

    let mut directories = HashMap::new();
    directories.insert(
        "/Users/me/proj".into(),
        DirectoryConfig {
            run_command: "npm run dev".into(),
            test_command: "npm test".into(),
            build_command: "npm run build".into(),
        },
    );

    let m = Manifest {
        last_cwd: Some("/Users/me/proj".into()),
        directories,
        ..Manifest::default()
    };

    save_to(&path, &m).unwrap();
    let loaded = load_from(&path).unwrap();
    assert_eq!(loaded.last_cwd.as_deref(), Some("/Users/me/proj"));
    let cfg = loaded.directories.get("/Users/me/proj").unwrap();
    assert_eq!(cfg.run_command, "npm run dev");
    assert_eq!(cfg.test_command, "npm test");
    assert_eq!(cfg.build_command, "npm run build");
}

#[test]
fn loads_legacy_manifest_without_new_fields() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("state.json");
    let legacy = r#"{
        "sessions": [{"id":"a","cwd":"/tmp","name":"s","created":1}],
        "theme": "dark",
        "font_family": "JetBrains Mono",
        "font_size": 13
    }"#;
    std::fs::write(&path, legacy).unwrap();
    let loaded = load_from(&path).unwrap();
    assert_eq!(loaded.sessions.len(), 1);
    assert!(loaded.last_cwd.is_none());
    assert!(loaded.directories.is_empty());
}
