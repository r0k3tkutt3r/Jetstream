use ccshell_core::session::{PermissionMode, cycle_mode, render_mode_control};

#[test]
fn cycle_order() {
    let m = PermissionMode::BypassPermissions;
    let m = cycle_mode(m);
    assert_eq!(m, PermissionMode::Plan);
    let m = cycle_mode(m);
    assert_eq!(m, PermissionMode::AcceptEdits);
    let m = cycle_mode(m);
    assert_eq!(m, PermissionMode::BypassPermissions);
}

#[test]
fn control_request_shape() {
    let s = render_mode_control(PermissionMode::Plan);
    let v: serde_json::Value = serde_json::from_str(&s).unwrap();
    assert_eq!(v["type"], "control_request");
    assert_eq!(v["request"]["subtype"], "set_permission_mode");
    assert_eq!(v["request"]["mode"], "plan");
}
