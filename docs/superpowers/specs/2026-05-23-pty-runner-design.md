# PTY-Backed Interactive Command Runner

**Date:** 2026-05-23
**Status:** Draft

## Goal

Replace the blocking `run_directory_command` with a PTY-backed runner so Run/Test/Build commands support interactive prompts (arrow-key dropdowns, y/n confirmations, password inputs) while keeping the current 15-line toast as the default view. The toast becomes a live tail of a PTY buffer; clicking it expands into a mini-terminal that forwards keystrokes.

## Non-Goals

- Multiple concurrent command runs. The existing single-run-at-a-time (`running()`) constraint stays.
- Full terminal emulator embedded in the left pane. The expanded view lives in a bottom sheet overlay, not inline.
- Auto-detection of "waiting for input" heuristics. User clicks to expand; no magic.

## Current Behavior

`run_directory_command` (commands.rs:358) does:
1. `tokio::process::Command::new("sh").arg("-c").arg(cmd).output().await`
2. Collects all stdout/stderr, takes last 15 lines of each.
3. Returns `CommandOutput { exit_code, stdout_tail, stderr_tail, command }`.
4. Frontend awaits the full result, pushes a static toast.

**Problems**: no stdin, no PTY (so inquirer-style prompts break), no streaming (toast appears only after exit), no way to kill mid-run.

## Design

### 1. Rust: `CommandRunner` (crates/core)

New module `crates/core/src/command_runner.rs`.

```rust
use portable_pty::{native_pty_system, PtySize, CommandBuilder, MasterPty};

pub struct CommandRunner {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    buffer: Arc<Mutex<VecDeque<u8>>>,
    exited: Arc<AtomicBool>,
    exit_code: Arc<Mutex<Option<i32>>>,
}
```

**Lifecycle**:
- `CommandRunner::spawn(cmd: &str, cwd: &Path, cols: u16, rows: u16) -> Result<Self>`
  - Creates a PTY via `native_pty_system().openpty(PtySize { rows, cols, .. })`
  - Builds `CommandBuilder::new("sh").args(["-c", cmd]).cwd(cwd)`
  - Spawns child on the slave side
  - Kicks off a reader task: reads master → appends to ring buffer (capped at 64 KB)
- `write_input(&self, data: &[u8]) -> Result<()>` — writes to master
- `resize(&self, cols: u16, rows: u16) -> Result<()>` — `master.resize()`
- `kill(&mut self) -> Result<()>` — `child.kill()`
- `tail(&self, lines: usize) -> String` — scans buffer for last N newlines
- `try_wait(&mut self) -> Option<i32>` — non-blocking exit check
- `buffer_snapshot(&self) -> Vec<u8>` — full buffer for the expanded terminal view

The ring buffer is a `VecDeque<u8>` capped at 64 KB. When full, bytes are drained from the front. This keeps memory bounded while preserving enough history for the expanded view.

**Reader task** (tokio::spawn):
```rust
loop {
    let mut buf = [0u8; 4096];
    match master_reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
            ring_buffer.lock().extend(&buf[..n]);
            output_tx.send(buf[..n].to_vec()).ok();
        }
        Err(_) => break,
    }
}
// After loop: poll exit code, send exit event
```

`output_tx` is a `tokio::sync::broadcast::Sender<Vec<u8>>` that the Tauri command layer subscribes to for event emission.

### 2. Tauri Commands (crates/app)

Replace `run_directory_command` with four commands. State holds `Option<CommandRunner>` behind a `Mutex`.

```rust
#[tauri::command]
pub async fn start_command(
    state: State<'_, Mutex<Option<CommandRunner>>>,
    app: AppHandle,
    cwd: String,
    kind: String,
) -> Result<(), String>
```

Resolves the command string from the manifest (same as today), spawns `CommandRunner`, subscribes to its output broadcast, and emits events on `command://output` and `command://exit`.

```rust
#[tauri::command]
pub async fn send_command_input(
    state: State<'_, Mutex<Option<CommandRunner>>>,
    data: String,
) -> Result<(), String>
```

Writes `data.as_bytes()` to the runner. Frontend sends raw key data (including escape sequences for arrow keys).

```rust
#[tauri::command]
pub async fn resize_command(
    state: State<'_, Mutex<Option<CommandRunner>>>,
    cols: u16,
    rows: u16,
) -> Result<(), String>
```

Forwards to `runner.resize()`.

```rust
#[tauri::command]
pub async fn kill_command(
    state: State<'_, Mutex<Option<CommandRunner>>>,
) -> Result<(), String>
```

Kills the child process, cleans up state.

### 3. Tauri Events

Events emitted on fixed channels (same pattern as `session://{id}`):

| Channel | Payload | When |
|---|---|---|
| `command://output` | `{ data: number[] }` | Each PTY read chunk (raw bytes, including ANSI) |
| `command://exit` | `{ exit_code: number, tail: string }` | Process exits (tail = last 15 lines, stripped of ANSI for the toast) |

The `data` field is raw bytes (not a string) because PTY output can contain partial UTF-8 sequences across chunk boundaries. xterm.js handles this natively.

### 4. Frontend: IPC

New functions in `bridge.ts`:

```ts
startCommand: (cwd: string, kind: CommandKind) =>
  invoke<void>("start_command", { cwd, kind }),

sendCommandInput: (data: string) =>
  invoke<void>("send_command_input", { data }),

resizeCommand: (cols: number, rows: number) =>
  invoke<void>("resize_command", { cols, rows }),

killCommand: () =>
  invoke<void>("kill_command"),
```

New event subscriptions:

```ts
export function subscribeCommandOutput(cb: (data: number[]) => void): Promise<UnlistenFn> {
  return listen<{ data: number[] }>("command://output", (e) => cb(e.payload.data));
}

export function subscribeCommandExit(cb: (code: number, tail: string) => void): Promise<UnlistenFn> {
  return listen<{ exit_code: number; tail: string }>("command://exit", (e) =>
    cb(e.payload.exit_code, e.payload.tail));
}
```

### 5. Frontend: Toast State Machine

The toast transitions through these states:

```
idle ──▶ streaming ──▶ completed
              │              │
              ▼              ▼
          expanded ──▶ completed-expanded
              │
              ▼
          collapsed (back to streaming)
```

- **idle**: no command running. No toast visible.
- **streaming**: command is running. Toast visible in top-right corner. Shows:
  - Title: `▶ run` (or test/build) with a pulsing dot
  - Body: last 15 lines of PTY output (plain text, ANSI stripped via a lightweight regex)
  - Kill button (×) in the corner
  - "Click to expand" hint at the bottom
  - Updates live as `command://output` events arrive
- **expanded**: full terminal overlay. See section 6.
- **collapsed**: user collapsed the expanded view; back to streaming toast.
- **completed**: process exited. Toast shows final success/error state (same colors as today). Auto-dismiss after 8s. Body = last 15 lines.
- **completed-expanded**: process exited while expanded. Terminal stays open (scrollable history) with an exit code banner. Close button dismisses.

**Toast component changes**: The static `Toast` interface gains a `live?: boolean` flag. When live, the toast re-renders on each output event instead of showing static text.

### 6. Frontend: Expanded Terminal View

New component `ui/src/render/CommandTerminal.tsx`.

Uses `@xterm/xterm` + `@xterm/addon-fit`:

```tsx
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
```

**Layout**: bottom sheet overlay anchored to the bottom of the window. 40% viewport height, full width. Dark background matching the app theme. Has:
- Header bar: `$ {command}` label, elapsed time, kill button (if running), close button
- Terminal area: xterm.js instance, auto-fitted to container
- On mount: writes the full buffer snapshot (via a new `getCommandBuffer()` IPC that returns the ring buffer) so the user sees history, not a blank screen

**Key forwarding**: xterm.js `onData` callback → `ipc.sendCommandInput(data)`. This handles arrow keys, enter, ctrl+c etc. natively — xterm.js converts DOM keyboard events into the correct escape sequences.

**Resize**: `FitAddon` observes container size → `ipc.resizeCommand(cols, rows)`.

**Cleanup**: on close/unmount, unsubscribe from events. If the process is still running, it keeps running (toast reverts to streaming view). The user can re-expand.

### 7. LeftPane Changes

`runCommand` becomes:

```tsx
const runCommand = async (kind: CommandKind) => {
  const value = fieldValue(kind).trim();
  if (!value || !props.cwd) return;
  setRunning(kind);
  try {
    await ipc.startCommand(props.cwd, kind);
    // Toast transitions handled by event listeners in App.tsx
  } catch (err) {
    const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
    props.onShowToast("error", `${kind} failed`, msg);
    setRunning(null);
  }
};
```

`setRunning(null)` now happens when the `command://exit` event fires (handled in App.tsx), not in the finally block.

### 8. App.tsx Wiring

App.tsx gains:
- `commandState` signal: `{ kind: CommandKind, status: "streaming"|"expanded"|"completed", lines: string[], exitCode?: number }`
- On mount: subscribe to `command://output` and `command://exit`
- `command://output`: append to a line buffer (cap at 200 lines for the toast view), update `commandState`
- `command://exit`: set status to completed, update `exitCode`, start 8s auto-dismiss timer, call `setRunning(null)` on the LeftPane (via a callback prop or a shared signal)

The live toast replaces the static toast stack entry when a command is running.

## Dependencies

### Rust (workspace Cargo.toml)
```toml
portable-pty = "0.8"
```
Add to `crates/core/Cargo.toml` dependencies.

### Frontend (ui/package.json)
```json
"@xterm/xterm": "^5.5.0",
"@xterm/addon-fit": "^0.10.0"
```

## Backwards Compatibility

- `run_directory_command` Tauri command stays registered but deprecated. Existing code paths that call it still work. New frontend code calls `start_command` instead.
- `CommandOutput` type unchanged — `command://exit` payload is a superset.
- Toast visual style for completed commands matches current behavior (same colors, same 8s dismiss).

## Files Touched

### Rust
- `Cargo.toml` — add `portable-pty` to workspace deps
- `crates/core/Cargo.toml` — add `portable-pty` dep
- `crates/core/src/command_runner.rs` — NEW: PTY runner
- `crates/core/src/lib.rs` — export `command_runner`
- `crates/app/src/commands.rs` — add `start_command`, `send_command_input`, `resize_command`, `kill_command`, `get_command_buffer`; keep old `run_directory_command`
- `crates/app/src/main.rs` — register new commands, add `Option<CommandRunner>` to managed state

### Frontend
- `ui/package.json` — add xterm deps
- `ui/src/ipc/types.ts` — add `CommandState` type
- `ui/src/ipc/bridge.ts` — add new IPC functions + event subscriptions
- `ui/src/render/CommandTerminal.tsx` — NEW: xterm.js expanded view
- `ui/src/render/LiveToast.tsx` — NEW: streaming toast component
- `ui/src/panes/LeftPane.tsx` — change `runCommand` to call `startCommand`
- `ui/src/App.tsx` — command event subscriptions, state management, mount CommandTerminal + LiveToast

## Tests

### Unit (crates/core)
- `command_runner_spawn_and_exit` — spawn `echo hello`, read output, assert exit 0
- `command_runner_write_input` — spawn `cat`, write bytes, read them back
- `command_runner_kill` — spawn `sleep 60`, kill, assert exit code
- `command_runner_tail` — spawn multi-line output, assert `tail(5)` returns last 5 lines
- `command_runner_ring_buffer_cap` — write >64KB, assert buffer stays bounded

### Manual
- Run `npx expo run:ios --device` — see device picker, arrow-key to select, press enter
- Run `cargo build` — see scrolling build output in toast, click to expand, see full terminal
- Kill mid-run — click × on toast during a long build, confirm process stops
- Resize — expand terminal, resize window, confirm reflow

## Risks

- `portable-pty` on macOS uses `forkpty()` which is well-supported but can leak file descriptors if the reader task panics before closing the master. Mitigate with Drop impl on `CommandRunner` that kills the child and closes the master.
- xterm.js is ~800KB (gzipped ~250KB). First use of a heavyweight JS dep. Acceptable because it's the only component that needs a real terminal emulator — no lightweight alternative handles ANSI + input correctly.
- PTY output chunks can split multi-byte UTF-8 sequences. The toast's ANSI-strip + line-split must operate on the ring buffer (bytes), not on per-chunk strings. xterm.js handles raw bytes natively via its `write(Uint8Array)` method.
