use ccshell_core::agents::AgentRegistry;
use std::fs;
use tempfile::tempdir;

fn write_agent(dir: &std::path::Path, slug: &str, body: &str) {
    fs::write(dir.join(format!("{slug}.md")), body).unwrap();
}

#[test]
fn scans_user_and_project_dirs() {
    let user = tempdir().unwrap();
    let proj = tempdir().unwrap();

    write_agent(
        user.path(),
        "code-reviewer",
        r#"---
name: code-reviewer
description: review code
model: sonnet
---
body"#,
    );
    write_agent(
        proj.path(),
        "my-local",
        r#"---
name: my-local
description: project agent
---
body"#,
    );

    let reg = AgentRegistry::scan(&[user.path().into(), proj.path().into()]);
    let names: Vec<&str> = reg.agents().iter().map(|a| a.name.as_str()).collect();
    assert!(names.contains(&"code-reviewer"));
    assert!(names.contains(&"my-local"));
}

#[test]
fn project_overrides_user_with_same_name() {
    let user = tempdir().unwrap();
    let proj = tempdir().unwrap();
    write_agent(
        user.path(),
        "shared",
        "---\nname: shared\ndescription: user version\n---\nU",
    );
    write_agent(
        proj.path(),
        "shared",
        "---\nname: shared\ndescription: project version\n---\nP",
    );

    let reg = AgentRegistry::scan(&[user.path().into(), proj.path().into()]);
    let shared = reg
        .agents()
        .into_iter()
        .find(|a| a.name == "shared")
        .unwrap();
    assert_eq!(shared.description, "project version");
}

#[test]
fn malformed_frontmatter_does_not_crash() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("bad.md"), "no frontmatter here").unwrap();
    fs::write(
        dir.path().join("good.md"),
        "---\nname: good\ndescription: ok\n---\n",
    )
    .unwrap();
    let reg = AgentRegistry::scan(&[dir.path().into()]);
    assert_eq!(reg.agents().len(), 1);
    assert_eq!(reg.agents()[0].name, "good");
}
