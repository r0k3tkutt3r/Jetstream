use parking_lot::Mutex;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

pub struct CaffeinateCtl {
    binary:   String,
    args:     Vec<&'static str>,
    child:    Mutex<Option<Child>>,
    refcount: AtomicUsize,
}

impl Default for CaffeinateCtl {
    fn default() -> Self {
        Self::new_with_binary("/usr/bin/caffeinate")
    }
}

impl CaffeinateCtl {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_with_binary(binary: &str) -> Self {
        Self {
            binary: binary.to_string(),
            args: if binary.ends_with("/caffeinate") { vec!["-dimsu"] } else { vec![] },
            child: Mutex::new(None),
            refcount: AtomicUsize::new(0),
        }
    }

    pub fn refcount(&self) -> usize { self.refcount.load(SeqCst) }

    pub fn pid(&self) -> Option<u32> {
        self.child.lock().as_ref().map(|c| c.id())
    }

    pub fn acquire(&self) {
        if self.refcount.fetch_add(1, SeqCst) == 0 {
            let spawned = Command::new(&self.binary)
                .args(&self.args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
            *self.child.lock() = spawned;
        }
    }

    pub fn release(&self) {
        loop {
            let cur = self.refcount.load(SeqCst);
            if cur == 0 { return; }
            if self.refcount.compare_exchange(cur, cur - 1, SeqCst, SeqCst).is_ok() {
                if cur == 1 {
                    if let Some(mut c) = self.child.lock().take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }
                return;
            }
        }
    }
}

impl Drop for CaffeinateCtl {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.lock().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}
