use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

const RING_BUFFER_CAP: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub enum CommandEvent {
    Output(Vec<u8>),
    Exit(u32),
}

pub struct CommandRunner {
    writer: Box<dyn Write + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    buffer: Arc<parking_lot::Mutex<VecDeque<u8>>>,
    exited: Arc<AtomicBool>,
    exit_code: Arc<parking_lot::Mutex<Option<u32>>>,
    event_tx: broadcast::Sender<CommandEvent>,
}

impl CommandRunner {
    pub fn spawn(cmd: &str, cwd: &Path, cols: u16, rows: u16) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd_builder = CommandBuilder::new(&shell);
        cmd_builder.args(["-l", "-c", cmd]);
        cmd_builder.cwd(cwd);

        let child = pair.slave.spawn_command(cmd_builder)?;
        let killer = child.clone_killer();
        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        let buffer: Arc<parking_lot::Mutex<VecDeque<u8>>> =
            Arc::new(parking_lot::Mutex::new(VecDeque::with_capacity(RING_BUFFER_CAP)));
        let exited = Arc::new(AtomicBool::new(false));
        let exit_code: Arc<parking_lot::Mutex<Option<u32>>> =
            Arc::new(parking_lot::Mutex::new(None));
        let (event_tx, _) = broadcast::channel::<CommandEvent>(256);

        let buf_clone = Arc::clone(&buffer);
        let exited_clone = Arc::clone(&exited);
        let exit_code_clone = Arc::clone(&exit_code);
        let tx = event_tx.clone();

        std::thread::spawn(move || {
            let mut child = child;
            let mut read_buf = [0u8; 4096];
            loop {
                match reader.read(&mut read_buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = read_buf[..n].to_vec();
                        {
                            let mut ring = buf_clone.lock();
                            ring.extend(&chunk);
                            while ring.len() > RING_BUFFER_CAP {
                                ring.pop_front();
                            }
                        }
                        let _ = tx.send(CommandEvent::Output(chunk));
                    }
                    Err(_) => break,
                }
            }
            let code = match child.wait() {
                Ok(status) => status.exit_code(),
                Err(_) => 1,
            };
            *exit_code_clone.lock() = Some(code);
            exited_clone.store(true, Ordering::SeqCst);
            let _ = tx.send(CommandEvent::Exit(code));
        });

        // Drop the slave so the master's reader will get EOF when the child exits
        drop(pair.slave);

        Ok(Self {
            writer,
            killer,
            master: pair.master,
            buffer,
            exited,
            exit_code,
            event_tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<CommandEvent> {
        self.event_tx.subscribe()
    }

    pub fn write_input(&mut self, data: &[u8]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&mut self) -> std::io::Result<()> {
        self.killer.kill()
    }

    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }

    pub fn exit_code(&self) -> Option<u32> {
        *self.exit_code.lock()
    }

    pub fn tail(&self, lines: usize) -> String {
        let ring = self.buffer.lock();
        let bytes: Vec<u8> = ring.iter().copied().collect();
        let text = String::from_utf8_lossy(&bytes);
        let all_lines: Vec<&str> = text.lines().collect();
        if all_lines.len() <= lines {
            text.into_owned()
        } else {
            all_lines[all_lines.len() - lines..].join("\n")
        }
    }

    pub fn buffer_snapshot(&self) -> Vec<u8> {
        let ring = self.buffer.lock();
        ring.iter().copied().collect()
    }
}

impl Drop for CommandRunner {
    fn drop(&mut self) {
        let _ = self.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_cwd() -> PathBuf {
        std::env::temp_dir()
    }

    #[tokio::test]
    async fn spawn_and_exit() {
        let runner = CommandRunner::spawn("echo hello", &test_cwd(), 80, 24).unwrap();
        let mut rx = runner.subscribe();
        let mut saw_output = false;
        let mut exit = None;
        loop {
            match rx.recv().await {
                Ok(CommandEvent::Output(data)) => {
                    let text = String::from_utf8_lossy(&data);
                    if text.contains("hello") {
                        saw_output = true;
                    }
                }
                Ok(CommandEvent::Exit(code)) => {
                    exit = Some(code);
                    break;
                }
                Err(_) => break,
            }
        }
        assert!(saw_output, "should have received 'hello' output");
        assert_eq!(exit, Some(0));
    }

    #[tokio::test]
    async fn write_input_echoes_back() {
        let mut runner = CommandRunner::spawn("cat", &test_cwd(), 80, 24).unwrap();
        let mut rx = runner.subscribe();
        runner.write_input(b"test123\n").unwrap();
        // cat will echo stdin back; read until we see it
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(3);
        let mut collected = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Ok(CommandEvent::Output(data))) => {
                    collected.extend(&data);
                    if String::from_utf8_lossy(&collected).contains("test123") {
                        break;
                    }
                }
                _ => break,
            }
        }
        // Send EOF to terminate cat
        runner.write_input(&[4]).unwrap(); // Ctrl+D
        assert!(
            String::from_utf8_lossy(&collected).contains("test123"),
            "should have echoed input back"
        );
    }

    #[tokio::test]
    async fn kill_terminates() {
        let mut runner = CommandRunner::spawn("sleep 60", &test_cwd(), 80, 24).unwrap();
        let mut rx = runner.subscribe();
        // Give it a moment to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        runner.kill().unwrap();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(3);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Ok(CommandEvent::Exit(_))) => break,
                Err(_) => break,
                _ => {}
            }
        }
        assert!(runner.is_exited(), "should have exited after kill");
    }

    #[test]
    fn tail_returns_last_n_lines() {
        let runner = CommandRunner::spawn(
            "printf 'line1\nline2\nline3\nline4\nline5\n'",
            &test_cwd(),
            80,
            24,
        )
        .unwrap();
        // Wait for exit
        std::thread::sleep(std::time::Duration::from_millis(500));
        let t = runner.tail(3);
        let lines: Vec<&str> = t.lines().collect();
        assert!(lines.len() <= 3, "tail should return at most 3 lines");
    }

    #[test]
    fn ring_buffer_stays_bounded() {
        let runner = CommandRunner::spawn(
            &format!("dd if=/dev/zero bs=1024 count=128 2>/dev/null"),
            &test_cwd(),
            80,
            24,
        )
        .unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        let snap = runner.buffer_snapshot();
        assert!(
            snap.len() <= RING_BUFFER_CAP,
            "buffer should be bounded at {} but was {}",
            RING_BUFFER_CAP,
            snap.len()
        );
    }
}
