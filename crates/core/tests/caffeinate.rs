use jetstream_core::caffeinate::CaffeinateCtl;
use std::sync::Arc;

#[test]
fn idle_state_no_pid() {
    let c = CaffeinateCtl::new_with_binary("/usr/bin/true");
    assert!(c.pid().is_none());
    assert_eq!(c.refcount(), 0);
}

#[test]
fn acquire_release_balances() {
    let c = Arc::new(CaffeinateCtl::new_with_binary("/usr/bin/yes"));
    c.acquire();
    assert_eq!(c.refcount(), 1);
    assert!(c.pid().is_some(), "expected a child pid after acquire");
    c.acquire();
    assert_eq!(c.refcount(), 2);
    c.release();
    assert_eq!(c.refcount(), 1);
    assert!(c.pid().is_some(), "child must persist while refcount > 0");
    c.release();
    assert_eq!(c.refcount(), 0);
    assert!(c.pid().is_none(), "child must be killed at refcount 0");
}

#[test]
fn double_release_is_safe() {
    let c = CaffeinateCtl::new_with_binary("/usr/bin/yes");
    c.acquire();
    c.release();
    c.release(); // no panic
    assert_eq!(c.refcount(), 0);
}
