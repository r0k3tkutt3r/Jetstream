# Jetstream

A Tauri desktop app that wraps the `claude` CLI as a multi-session, multi-pane GUI shell. Built with a Rust backend (`crates/core`, `crates/app`) and a SolidJS frontend (`ui/src`).

## Testing

**Whenever the user says "test", use the computer-use MCP tools** to interact with the running app. Take a screenshot first to see the current state, then click/type as needed to verify behavior. Load all computer-use tools in one ToolSearch call: `{ query: "computer-use", max_results: 30 }`. Always call `request_access` before interacting.

To build and run for testing:
```bash
cd /Users/kushmodi/Coding/CursorProjects/Jetstream
cargo tauri dev
```

## Stack

- **Backend**: Rust, Tauri v2, Tokio async runtime
- **Frontend**: SolidJS + TypeScript (Vite, pnpm)
- **Protocol**: `claude` CLI in `--output-format stream-json --input-format stream-json` mode
- **Persistence**: JSON manifest at `~/Library/Application Support/Jetstream/state.json`
- **Session transcripts**: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

## Workspace Structure

```
crates/
  core/   – Session lifecycle, protocol parsing, caffeinate, agent registry
  app/    – Tauri commands (IPC bridge), state persistence (Manifest/DirectoryConfig)
ui/src/
  App.tsx          – Root: signal wiring, keyboard shortcuts, toast system
  panes/
    Layout.tsx     – Three-pane shell
    LeftPane.tsx   – Workspace panel (CWD, model/effort, sessions, project commands)
    CenterPane.tsx – Chat area (messages, activity bar, input composer)
    RightPane.tsx  – Subagents panel + context/cost footer
  composer/
    SlashPalette.tsx    – Autocomplete dropdown for `/` commands
    slash-handlers.ts   – Client-side slash command dispatcher
  state/
    session-store.ts    – SolidJS reactive store per session
  render/
    MessageList.tsx, Message.tsx, ToolView.tsx, TodoPanel.tsx
  ipc/
    bridge.ts      – Tauri invoke wrappers + event subscriptions
```

## Session Lifecycle

1. **Spawn**: `SessionManager::spawn` → `Session::spawn` launches `claude -p --output-format stream-json --input-format stream-json --include-partial-messages --include-hook-events --verbose --dangerously-skip-permissions --permission-mode bypassPermissions`. A new UUID is assigned unless `--resume` is passed.
2. **Event fan-out**: stdout lines are parsed → `SessionEvent` variants → 16 ms coalescing (merges `Assistant` deltas by `msg_id`) → broadcast channel → Tauri `emit("session://<id>", ev)` → frontend `handleEvent`.
3. **Stdin writer**: messages are sent as JSONL user messages: `{"type":"user","message":{"role":"user","content":"..."}}`.
4. **Mode control**: sent as `{"type":"control_request","request":{"subtype":"set_permission_mode","mode":"..."}}`.
5. **Interrupt**: sent as `{"type":"control_request","request":{"subtype":"interrupt"}}`.
6. **Close**: SIGKILL via `SessionManager::close`; session removed from manifest.
7. **Replay**: `replay_jsonl` re-parses a `.jsonl` transcript file and re-emits events to the frontend without spawning a real claude process.
8. **Resume**: re-spawns claude with `--resume <uuid>`, preserving conversation history.

## Permission Modes

Cycles: `bypassPermissions` → `plan` → `acceptEdits` → back to `bypassPermissions`.

- Triggered by **Shift+Tab** globally, or clicking the colored badge in the center pane header.
- The badge color encodes the mode: red (bypass), yellow (plan), green (acceptEdits), gray (default).
- Sent to the running claude process as a `set_permission_mode` control request.

## Three-Pane Layout

### Left Pane — Workspace

- **Working directory**: editable text field; 📁 button or **Cmd+O** opens a native folder picker. Last CWD is persisted across restarts.
- **Model & Effort selectors**: model (`sonnet`, `opus`, `haiku`) and effort (`low`, `medium`, `high`, `xhigh`, `max`). Persisted in manifest; applied to all new sessions.
- **Sessions list**: shows all sessions for the current CWD (active ones from the live manager + saved ones from the manifest). Click to activate/resume; hover reveals `×` to delete (Shift+click skips confirm dialog). "Clear all" deletes every session for the CWD.
- **Project commands**: per-directory `run`, `test`, and `build` shell commands. Saved with 400 ms debounce into `DirectoryConfig` in the manifest. The ▶ / ✓ / ⚙ buttons execute the command and show the last 15 lines of stdout/stderr in a toast.

### Center Pane — Chat

- **Header**: session name, cwd, truncated ID, current model+effort pill, permission mode badge.
- **Message list**: renders user and assistant messages; tool calls collapsed by default in `ToolView`.
- **Todo panel**: surfaces the live task list from `TodoWrite` tool calls below the message area.
- **Activity bar**: shown while `status === "thinking" | "tool"`. Displays current action label, elapsed time (seconds/minutes), and live token counter (↓ input during loading, ↑ output while streaming).
- **Message queue**: messages sent while claude is busy are queued and shown above the input; drained automatically when the session goes idle.
- **Composer**: textarea; Enter sends, Shift+Enter inserts newline. Up/Down arrows navigate the last 5 sent messages (history ring). Typing `/` opens the slash palette.

### Right Pane — Subagents & Context

- **Subagents**: active subagents shown with accent border (agent name + prompt); last 5 completed shown as dimmed entries.
- **Context bar**: cumulative token count vs 1M window. Bar turns red above 80%.
- **Usage breakdown**: input, output, cache read, cache write token counts from the last `Result` event.
- **Footer**: caffeinate status (☕ off / holding N) + running session cost in USD.

## Caffeinate

`CaffeinateCtl` runs `/usr/bin/caffeinate -dimsu` (macOS sleep prevention) with a reference count. Count increments on the first `Assistant|Tool|ToolResult` event of a turn; decrements on `Result|Error|Closed`. The right pane polls status every 2 seconds.

## Slash Commands

Typing `/` opens an autocomplete palette. On submit:

- `/clear` — client-side: resets the SolidJS message store (does not affect claude's context).
- `/model <name>` — client-side: calls `switch_model` IPC, which kills the old process and respawns with `--resume` + `--model <name>`, preserving conversation history.
- All other commands (`/context`, `/cost`, `/compact`, `/memory`, `/agents`, `/mcp`, etc.) — pass through to the claude CLI as a stream-json user message; claude emits a synthetic assistant reply.

## Agent Discovery

`list_agents` scans:
1. `~/.claude/agents/`
2. All `agents/` subdirectories under `~/.claude/plugins/` (up to depth 8)
3. `.claude/agents/` in the current working directory

## State Persistence (Manifest)

File: `~/Library/Application Support/Jetstream/state.json`

Fields: `sessions[]`, `window` (width/height, pane visibility), `theme`, `font_family`, `font_size`, `last_cwd`, `directories` (map of cwd → `DirectoryConfig`), `model`, `effort`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Cmd+N | New session |
| Cmd+O | Pick working directory |
| Cmd+B | Toggle left pane |
| Cmd+J | Toggle right pane |
| Cmd+, | Open settings |
| Shift+Tab | Cycle permission mode |
| Enter | Send message |
| Shift+Enter | Insert newline |
| ↑ / ↓ | Navigate input history (at cursor start or in history mode) |

## Build & Dev

```bash
# Frontend only
cd ui && pnpm install && pnpm dev

# Full Tauri dev build (backend + frontend)
cargo tauri dev

# Release
cargo tauri build

# Backend tests
cargo test -p jetstream-core
cargo test -p jetstream-app
```

Set `CCSHELL_CLAUDE_BIN=/path/to/claude` to override the auto-detected claude binary. Default lookup order: env var → `which claude` → known paths (`~/.local/bin/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`).

Set `RUST_LOG=debug` to see stderr output from claude processes.
