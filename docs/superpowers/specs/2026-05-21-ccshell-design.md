# CCShell — Design Spec

**Status:** Draft for approval
**Date:** 2026-05-21
**Owner:** kushmodi
**Project root:** `/Users/kushmodi/Coding/CursorProjects/CCShell`

## 1. Purpose

CCShell is a Rust + Tauri desktop application that wraps the `claude` CLI in an
agent-first GUI. It supersedes the native terminal interface for users who run
multiple parallel Claude Code sessions, dispatch subagents heavily, and want to
see what every session is doing at a glance.

It is not a generic terminal emulator. It speaks one wire protocol — claude's
`--input-format stream-json --output-format stream-json` — and renders that
protocol as a structured conversation.

## 2. Goals & non-goals

### Goals (v1)

- Native macOS desktop app, single binary, GPU-composited UI through Tauri's
  WKWebView, smooth at 60–120 fps under typical streaming load.
- Run one `claude` child process per session with full bidirectional
  stream-json IPC; surface every event (assistant deltas, tool calls, subagent
  start/stop, hooks, results) in a custom UI.
- Three-pane workspace: sessions + agent library on the left, focused
  conversation in the middle, live subagent panel on the right.
- Start every session with `--dangerously-skip-permissions`. Cycle modes with
  `Shift+Tab` (bypass → plan → acceptEdits → bypass) using a mid-session
  `control_request`, with a `--resume`-based respawn fallback.
- Inline slash command autocomplete in the composer, sourced from the running
  claude CLI itself (no maintained command list in CCShell).
- Spawn `/usr/bin/caffeinate -dimsu` whenever ≥ 1 claude session is running;
  kill it on the last release.
- Browse agents from `~/.claude/agents/` and `./.claude/agents/`; click to
  launch a session with `--agent <slug>`. Editing agent files opens the user's
  `$EDITOR`.
- Resume any previous session via `--resume <uuid>` from claude's canonical
  JSONL store in `~/.claude/projects/`.

### Non-goals (v1)

- Editing agent `.md` files in-app.
- Plugin or MCP management UI (use `/mcp` etc. inside the session).
- Multi-window. One window, many sessions in the left pane.
- Linux and Windows builds (codepaths kept portable; only macOS is tested and
  shipped in v1).
- Custom theming beyond dark/light + font size.
- Built-in terminal emulator. CCShell does not run arbitrary shells; only the
  `claude` child.

## 3. Architectural overview

```
┌──────────────────────── Tauri App ─────────────────────────┐
│                                                            │
│  Rust core (process supervisor + IPC bridge)               │
│    • SessionManager  — owns N child claude processes       │
│    • Session         — one claude -p stream-json child     │
│    • CaffeinateCtl   — refcount; spawns/kills caffeinate   │
│    • AgentRegistry   — scans ~/.claude/agents + project    │
│    • SlashRegistry   — fetched once per session, cached    │
│                                                            │
│        ▲                                                   │
│        │  tauri::ipc commands + per-session event channel  │
│        ▼                                                   │
│                                                            │
│  WebView (WKWebView) — SolidJS + TypeScript + Vite         │
│    • per-session reactive store (createStore)              │
│    • virtualized message list (@tanstack/solid-virtual)    │
│    • slash palette, mode chip, subagent panel              │
│                                                            │
└────────────────────────────────────────────────────────────┘
                  │                              │
                  ▼                              ▼
       /usr/bin/claude (× N)         /usr/bin/caffeinate -dimsu (× 0 or 1)
```

Three layers, one binary: Rust core, Tauri IPC, Solid frontend. The Rust core
is the only owner of subprocesses and the only source of truth for session
state. The frontend rebuilds its view via replay on demand.

## 4. Crate / package layout

```
ccshell/
├── Cargo.toml                  workspace
├── crates/
│   ├── core/                   subprocess + IPC supervisor (no Tauri dep)
│   │   ├── src/session.rs      Session struct, reader/writer tasks
│   │   ├── src/manager.rs      SessionManager
│   │   ├── src/caffeinate.rs   CaffeinateCtl
│   │   ├── src/agents.rs       AgentRegistry
│   │   ├── src/protocol.rs     stream-json types (serde)
│   │   └── src/error.rs        SessionError enum
│   └── app/                    Tauri shell
│       ├── tauri.conf.json
│       └── src/main.rs         tauri::Builder, command handlers
├── ui/                         Solid + Vite frontend
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── state/session-store.ts
│       ├── ipc/bridge.ts
│       ├── panes/{Left,Center,Right}.tsx
│       ├── composer/{Composer,SlashPalette}.tsx
│       ├── render/{Message,Tool,SubagentCard}.tsx
│       └── styles/
└── docs/superpowers/specs/2026-05-21-ccshell-design.md
```

Rationale: `core` has zero Tauri dependency, so it is testable as a plain Rust
library with `cargo test`. `app` is the thin Tauri shell that wires commands
to `core`. UI is a vanilla Vite project built into `ui/dist/`, served by
Tauri.

## 5. Process model

### 5.1 Per-session command line

```text
/usr/bin/claude
  -p
  --output-format stream-json
  --input-format  stream-json
  --include-partial-messages
  --include-hook-events
  --verbose
  --dangerously-skip-permissions
  --session-id <uuid-v4>
  --permission-mode bypassPermissions
  [--resume <uuid>]                  only when resuming
  [--name <display-name>]            optional
  [--agent <slug>]                   optional
```

`-p` plus the stream-json input/output keeps the child alive consuming
newline-delimited JSON on stdin. The session UUID is generated by CCShell so
the same identity survives a child crash via `--resume`.

### 5.2 Session struct

```rust
pub struct Session {
    pub id:        Uuid,
    pub name:      String,
    pub cwd:       PathBuf,
    pub mode:      PermissionMode,
    pub state:     Arc<RwLock<SessionState>>,
    pub child:     Child,
    stdin_tx:      mpsc::Sender<UserInput>,
    events_tx:     broadcast::Sender<SessionEvent>,
    mode_strategy: ModeChangeStrategy,        // ControlRequest | Respawn
}

pub enum SessionState { Idle, Thinking, Tool, Error, Closed }

pub enum SessionEvent {
    Assistant     { delta: String, msg_id: String },
    Tool          { id: String, name: String, input: Value },
    ToolResult    { id: String, output: Value, is_error: bool },
    SubagentStart { id: String, agent: String, prompt: String },
    SubagentStop  { id: String, result: Value },
    Hook          { event: String, payload: Value },
    Result        { usage: Usage, cost_usd: f64 },
    Resync,                                   // tells frontend to replay
    Error         { message: String, recoverable: bool },
    Closed        { code: i32 },
}
```

### 5.3 Two long-lived async tasks per session

**Reader task** — owns `child.stdout`, `BufReader::read_line()` loop. Each
line `serde_json::from_str::<StreamJsonEvent>` → mapped to one or more
`SessionEvent`s → fanned out on a `tokio::sync::broadcast` channel of size
1024. The Tauri layer subscribes once per session and emits as
`tauri::Event::emit_to(window, "session://<uuid>", evt)`.

Partial-message deltas are coalesced before emit: a `tokio::time::interval`
at 16 ms accumulates pending deltas per `msg_id` and flushes once per tick.
This caps event traffic at 60 Hz regardless of how fast claude emits tokens,
without dropping any character.

**Writer task** — owns `child.stdin`, reads from `mpsc::Receiver<UserInput>`.
One JSON object per line, then flush. Three input variants:

```jsonc
{"type":"user","message":{"role":"user","content":"fix the failing test"}}
{"type":"control_request","request":{"subtype":"set_permission_mode","mode":"plan"}}
{"type":"control_request","request":{"subtype":"interrupt"}}
```

### 5.4 Backpressure

`broadcast` lag → `RecvError::Lagged(n)` → reader emits a synthetic `Resync`
event → frontend calls `replay_session(uuid)`, which streams the JSONL file
from disk through the same event pipeline. The dropped window is recovered
deterministically from the canonical store.

### 5.5 Subagent tracking

Claude's hook events `SubagentStart` / `SubagentStop` carry the subagent
identity and prompt. Each session keeps a `BTreeMap<SubagentId,
SubagentRecord>` and emits deltas. The right pane is a pure projection of
this map.

## 6. Frontend state and rendering

### 6.1 Stores

One Solid store per session, siblings under a top-level
`sessions: Record<uuid, SessionStore>` signal. No global Redux.

```ts
type SessionStore = {
  meta:      { id: string; name: string; cwd: string; createdAt: number };
  mode:      Signal<PermissionMode>;
  status:    Signal<'idle' | 'thinking' | 'tool' | 'error' | 'closed'>;
  messages:  Store<Message[]>;
  subagents: Store<Record<string, SubagentRecord>>;
  usage:     Signal<Usage | null>;
  pendingInput: Signal<string>;
};
```

Assistant deltas mutate the *last* `Message`'s `content` field via Solid's
`produce`. One DOM text node updates per frame — no diff, no reconcile.

### 6.2 Virtualization

`@tanstack/solid-virtual` over `messages`. Dynamic heights, measured via
`ResizeObserver` and fed into `measureElement`. Off-screen rows unmount; a
10k-message session keeps the rendered DOM ≤ ~30 nodes.

### 6.3 Markdown and syntax highlighting

`markdown-it` (sync) for prose. `shiki` for code blocks, lazy-imported on
first code-block render. Rendered HTML cached in a `WeakMap` keyed by message
id. Re-render gated by `createMemo` on content equality.

### 6.4 IPC subscription

```ts
const unlisten = await listen<SessionEvent>(`session://${id}`, (e) => {
  match(e.payload, {
    Assistant:     ({ delta, msg_id }) => store.appendDelta(msg_id, delta),
    Tool:          (t) => store.recordTool(t),
    ToolResult:    (r) => store.completeTool(r),
    SubagentStart: (s) => store.startSubagent(s),
    SubagentStop:  (s) => store.stopSubagent(s),
    Result:        (r) => store.setUsage(r),
    Resync:        ()  => invoke('replay_session', { id }),
    Error:         (e) => store.setError(e),
    Closed:        ()  => store.setStatus('closed'),
  });
});
```

One listener per session. Tauri serializes JSON once in Rust, parses once in
JS — no double-encoding.

### 6.5 Persistence

Frontend is pure projection. On app start, `list_sessions()` returns the
CCShell manifest (see §11) after Rust has validated each entry against the
on-disk JSONL in `~/.claude/projects/`. Validated sessions populate the left
pane in "closed" state. Focusing one calls `replay_session(uuid)`, which
re-streams the JSONL through the event pipeline. No localStorage usage.

## 7. UX and layout

### 7.1 Three panes

**Left (220 px, `⌘B` to toggle).** Top half: active sessions, each with a
status dot (idle / thinking / tool / error). Bottom half: agent library,
grouped by namespace prefix (`qa-sec`, `lang`, `core-dev`, …), with a filter
input. Clicking an agent opens a "spawn with this agent" sheet that prefills
`--agent <slug>`.

**Middle.** Header strip: session name, cwd, mode chip (`bypass` purple,
`plan` violet, `acceptEdits` green), keybinding hint `⇧⇥ to cycle`.
Virtualized message scroller. Tool calls render as inset cards under the
assistant message, distinct icons per tool. Subagent invocations render
*both* in the transcript (as a card linking to the right pane) and as a live
row in the right pane.

Composer: auto-grow textarea (max 8 lines, then internal scroll). Slash
palette opens inline when input starts with `/` — fuzzy-matched floating
popover, arrow keys move highlight, `Tab` or `Enter` accepts. Composer never
loses focus during streaming.

**Right (260 px, `⌘J` to toggle).** Live subagent cards (one per active
`SubagentStart`): agent name, prompt summary, elapsed time, last tool call.
Completed subagents collapse to compact rows at the bottom; last 5 retained.
Footer: caffeinate status + cumulative `$` cost from `Result.usage`.

### 7.2 Keyboard map

| Shortcut | Action |
|---|---|
| `⌘N` | New session in current cwd |
| `⌘⇧N` | New session, pick cwd |
| `⌘1`–`⌘9` | Jump to session N |
| `⌘W` | Close session (confirm if running) |
| `⇧⇥` | Cycle mode (bypass → plan → acceptEdits → bypass) |
| `⌘K` | Command palette (fuzzy: slash commands + actions) |
| `/` | Inline slash autocomplete in composer |
| `⌘.` | Interrupt current turn (`control_request: interrupt`) |
| `⌘B` | Toggle left sidebar |
| `⌘J` | Toggle right subagent panel |
| `⌘,` | Settings sheet |

`⌘.` over `Ctrl+C` because Tauri webviews can't reliably intercept `Ctrl+C`
on macOS.

## 8. Slash command autocomplete

Source of truth is claude itself. On session spawn, Rust sends one
`control_request { subtype: "list_slash_commands" }` and caches the result.
Re-fetched on plugin/MCP/agent reload events. Fallback for older CLIs: one-
shot `claude -p --print --output-format json '/help'` parse.

```rust
struct SlashCommand {
    name:          String,
    namespace:     Option<String>,
    description:   String,
    argument_hint: Option<String>,
}
```

Frontend: `fuzzysort` matcher bound to the composer's leading-slash state.
Namespaced commands (`/voltagent-lang:rust-engineer`) match on both bare name
and fully-qualified form. `Tab`/`Enter` replaces `/foo` with `/foo ` and
dismisses; if `argument_hint` is present, render it as a dimmed inline ghost.

Slash commands are *not* executed in CCShell. The composer forwards the
literal text to claude via stream-json `user` message. Mutating commands
(`/clear`, `/compact`) trigger a `replay_session(uuid)` on receipt of the
corresponding `Result` event, rebuilding the message list from the canonical
JSONL.

## 9. Mode cycling

`⇧⇥` is a global accelerator scoped to the focused window. On fire, the
frontend calls `invoke('cycle_mode', { sessionId })`.

```rust
fn cycle(current: PermissionMode) -> PermissionMode {
    match current {
        PermissionMode::BypassPermissions => PermissionMode::Plan,
        PermissionMode::Plan              => PermissionMode::AcceptEdits,
        PermissionMode::AcceptEdits       => PermissionMode::BypassPermissions,
        _                                 => PermissionMode::BypassPermissions,
    }
}
```

Sent as one stdin line:

```jsonc
{"type":"control_request","request":{"subtype":"set_permission_mode","mode":"plan"}}
```

The Rust side waits up to 500 ms for the corresponding `control_response`
before flipping the UI chip. On timeout, surface a toast and leave the chip
unchanged.

**Fallback for older CLI versions.** If the first `set_permission_mode`
returns `control_error`, the session is marked `mode_strategy = Respawn`. All
subsequent cycles tear down the child and re-spawn with `--resume <uuid>
--permission-mode <new>`. The frontend sees no difference because history
re-streams via replay.

**Plan-mode transition note.** Plan mode does not roll back in-flight tool
calls; claude refuses the *next* tool. We surface a small inline toast:
"Plan mode: file edits and shell are now read-only."

## 10. Caffeinate orchestration

```rust
pub struct CaffeinateCtl {
    child:    Mutex<Option<Child>>,
    refcount: AtomicUsize,
}

impl CaffeinateCtl {
    pub fn acquire(&self) {
        if self.refcount.fetch_add(1, SeqCst) == 0 {
            let c = Command::new("/usr/bin/caffeinate")
                .args(["-dimsu"])
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .spawn().ok();
            *self.child.lock() = c;
        }
    }
    pub fn release(&self) {
        if self.refcount.fetch_sub(1, SeqCst) == 1 {
            if let Some(mut c) = self.child.lock().take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}
```

`SessionManager::spawn_session` calls `acquire()` *after* the child is
confirmed running, so a launch failure doesn't strand caffeinate.
`close_session`, the `child.wait()` reaper task, *and* `Drop` all converge
through a per-session `AtomicBool::swap` flag that guarantees `release()`
runs exactly once per session, including under panic-unwind or abrupt window
close.

A session in `error` state (still owned by the user, not yet closed) keeps
its `acquire`. Caffeinate releases only when the user explicitly closes the
session or the app exits. This is intentional: an errored session is one the
user is likely to inspect and resume.

Flags `-dimsu`: display, idle, system, disk-idle sleep prevention plus
simulated user activity. No `-w` (we own the lifecycle explicitly).

The right pane's footer renders the live `{ active, refcount }` projection.

## 11. Persistence

Claude already writes `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` per
session. CCShell adds exactly one file:

`~/Library/Application Support/CCShell/state.json`

```jsonc
{
  "sessions": [
    {"id": "8f3a…", "cwd": "/Users/k/proj", "name": "refactor-auth",
     "created": 1716240000}
  ],
  "window": { "width": 1400, "height": 900,
              "sidebarVisible": true, "rightPaneVisible": true },
  "theme":  "dark",
  "font":   { "family": "JetBrains Mono", "size": 13 }
}
```

No transcripts, no message bodies. On startup, validate each session's id
against its on-disk JSONL; orphans are dropped from the manifest.

## 12. Error handling

```rust
#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("claude binary not found at {0}")] NoBinary(PathBuf),
    #[error("claude exited unexpectedly: code {0}")] UnexpectedExit(i32),
    #[error("stream-json parse failure on line {line}: {source}")]
    ParseError { line: u64, #[source] source: serde_json::Error },
    #[error("control request timed out after {0:?}")] ControlTimeout(Duration),
    #[error("ipc channel lagged; client must resync")] Lagged,
    #[error("io: {0}")] Io(#[from] io::Error),
}
```

| Variant | UX |
|---|---|
| `NoBinary` | Full-screen error on app start with install link |
| `UnexpectedExit` | Session status → `error`; toast with "Restart" → `resume_session(uuid)` |
| `ParseError` | Logged + debug overlay (`⌘⌥D`); session continues, single line dropped, banner if rate > 1/sec |
| `ControlTimeout` | Inline toast on the mode chip; chip retains old value |
| `Lagged` | Auto-trigger `replay_session(uuid)`; 200 ms "reconnecting…" shimmer |

## 13. Testing strategy

1. **Rust unit tests (heaviest investment).** The stream-json parser, the
   session supervisor state machine, the caffeinate refcount, and the
   mode-cycle fallback. `insta` snapshot tests over fixture JSONL files
   captured from real claude runs — one fixture per interesting event:
   partial-message, tool-use, subagent-start/stop, hook, error, result.

2. **Frontend logic with Vitest.** Slash palette fuzzy match, message store
   delta-merge, keyboard handlers. Pure-functional; no JSDOM needed.

3. **End-to-end smoke** via `tauri-driver` + WebdriverIO. Three flows:
   cold-start to first message, second-session spawn + caffeinate refcount =
   2, mode cycle round-trip. macOS only in CI for v1.

## 14. Performance targets

- Cold start to interactive: ≤ 400 ms (warm filesystem, no resume).
- New-session spawn to first message accepted: ≤ 200 ms after claude child
  reports ready.
- Sustained 60 fps render during a partial-message burst at typical token
  rates (≥ 200 tok/s); zero dropped characters.
- Memory ceiling: ≤ 80 MB resident for the Rust core with 5 idle sessions;
  ≤ 250 MB total app footprint at 5 active sessions.
- Binary size: ≤ 18 MB universal macOS `.app`.

## 15. Open questions to resolve during implementation

- Exact name and shape of `list_slash_commands` control_request in the
  current CLI. If absent, ship the `/help` fallback first and revisit when
  the control variant lands.
- Whether `set_permission_mode` mid-session is acknowledged in claude
  2.1.146 specifically. If not, default `mode_strategy = Respawn` for v1.
- Whether `--include-partial-messages` emits per-token or per-chunk events
  on the current CLI. Affects the 16 ms coalescing constant — may need to
  drop to 8 ms or rise to 33 ms.

These are surfacing-only questions; none gate the architecture.
