# Busy-gated Caffeinate, Model/Effort Prefs, Custom Tool Rendering, Pinned Todos

**Date:** 2026-05-23
**Status:** Approved

## Goals

1. Caffeinate only runs while at least one session is actively processing a turn (no idle wake-lock). Multiple sessions share a single caffeinate process via refcount.
2. User can pick a model and an effort level via dropdowns. Selection persists globally and applies to every new session.
3. Tool calls in the message stream render with custom per-tool views instead of truncated JSON.
4. The latest TodoWrite payload is rendered in a pinned panel between the message list and the composer.

## Non-Goals

- Mid-session model or effort change. Both are applied at session spawn only.
- Tool result/output custom rendering (deferred — only inputs in this pass).
- Per-directory model overrides.

## 1. Busy-Gated Caffeinate

### Current behavior

`SessionManager::spawn` calls `caffeinate.acquire()`; `close` calls `release()`. Refcount tracks open sessions. A single caffeinate process is shared across sessions (refcount 0→1 spawns, last release kills).

### New behavior

Refcount tracks **busy** sessions, not open sessions.

- `Session` gains an `Arc<CaffeinateCtl>` (passed from manager) and an `is_busy: AtomicBool`.
- A new sniffer task spawned during `Session::spawn` subscribes to the session's event broadcast:
  - On `Assistant` / `Tool` / `ToolResult`: if `!is_busy`, swap to `true` and `caffeinate.acquire()`.
  - On `Result` / `Error` / `Closed`: if `is_busy`, swap to `false` and `caffeinate.release()`.
- `Session::Drop`: if `is_busy`, release.
- `SessionManager::spawn` / `close` no longer touch caffeinate.

### Why this prevents duplicates

`CaffeinateCtl::acquire` uses `fetch_add(1, SeqCst)` — only the 0→1 transition spawns a child. `release` uses a CAS loop and only kills on the 1→0 transition. With N busy sessions, refcount == N, single child. With N=0, no child.

### Tests

`crates/core/tests/manager.rs` rewritten:
- `caffeinate_acquires_on_first_busy_event` — spawn session, send Assistant event, assert refcount == 1.
- `caffeinate_releases_on_result_event` — drive busy → Result, assert refcount == 0.
- `caffeinate_shared_across_busy_sessions` — two sessions, both busy, refcount == 2; one finishes, refcount == 1.
- `caffeinate_idle_sessions_do_not_hold` — spawn session, no events, refcount == 0.

## 2. Model + Effort Preferences

### CLI flags (verified via `claude --help`)

- `--model <alias>` — accepts `sonnet`, `opus`, `haiku`, or a full model ID.
- `--effort <level>` — choices: `low`, `medium`, `high`, `xhigh`, `max`.

### SessionConfig extension

```rust
pub struct SessionConfig {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub name: String,
    pub agent: Option<String>,
    pub resume_id: Option<Uuid>,
    pub model: Option<String>,   // NEW
    pub effort: Option<String>,  // NEW
}
```

In `Session::spawn`, append `--model <m>` and `--effort <e>` when present.

### Manifest preferences

```rust
pub struct Manifest {
    ...
    #[serde(default)] pub model: Option<String>,
    #[serde(default)] pub effort: Option<String>,
}
```

### New Tauri commands

- `get_preferences() -> { model: Option<String>, effort: Option<String> }`
- `set_preferences({ model, effort }) -> ()`

`spawn_session` reads current preferences from the manifest and passes them through.

### UI

Two `<select>` dropdowns in `LeftPane`, between the Working-directory input and Sessions list:

```
MODEL    [ sonnet ▼ ]
EFFORT   [ medium ▼ ]
```

Values:
- Model: `sonnet`, `opus`, `haiku`
- Effort: `low`, `medium`, `high`, `xhigh`, `max`

Defaults if unset: `sonnet`, `medium`. On change → debounced `set_preferences`. Applied to every subsequent `spawn_session`.

CenterPane header also shows current session's `{model} · {effort}` next to the mode pill (read-only badge).

## 3. Custom Tool Rendering

### New component `ui/src/render/ToolView.tsx`

Exports `ToolBlock` (Component<{ tool: ToolCall }>). Switches on `tool.name`:

```ts
function pickRenderer(name: string): (input: any) => JSX.Element { ... }
```

| Tool | Render |
|---|---|
| `Read` | `📖 Read · {file_path}` + ` (lines {offset}-{offset+limit})` if range present |
| `Edit` | `✏️ Edit · {file_path}` + collapsed 1-line `- old → + new` (each side max 60 chars) |
| `MultiEdit` | `✏️ Edit · {file_path} ({n} edits)` |
| `Write` | `📝 Write · {file_path}` + `({lines} lines, {bytes} bytes)` from `content.length` |
| `Bash` | `$ {command}` in monospace, wrapped to 3 lines; description below in muted text |
| `Glob` | `🔍 Glob · {pattern}{ in path}?` |
| `Grep` | `🔍 Grep · {pattern} in {path}?` |
| `WebFetch` | `🌐 Fetch · {url}` + prompt preview |
| `WebSearch` | `🌐 Search · {query}` |
| `Task` / `Agent` | `🤖 {subagent_type ?? "agent"}: {description ?? prompt-tail}` |
| `TodoWrite` | `✓ Todos · {n} items` — full panel handled separately |
| _fallback_ | Existing behavior: `⚙ {name} {JSON.stringify(input).slice(0,80)}` |

Per-tool color from the existing `toolColor` helper extended for new names.

Renderers are pure: take `input: unknown`, defensively access fields with optional chaining, return `JSX`. They never throw.

`Message.tsx` swaps the inline tool block for `<ToolBlock tool={t} />`.

## 4. Pinned Todo Panel

### State

`session-store.ts` adds:

```ts
interface Todo {
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}
todos: Accessor<Todo[]>;
```

In `handleEvent`, when `Tool` arrives with `name === "TodoWrite"`:

```ts
const input = e.input as { todos?: Todo[] } | null;
if (input?.todos && Array.isArray(input.todos)) setTodos(input.todos);
```

`reset()` clears todos too.

### Component `ui/src/render/TodoPanel.tsx`

Mounted in `CenterPane` after `<MessageList>` and before the composer's `border-top` div.

Layout:
- Hidden when `todos.length === 0`.
- Compact header: `TODOS · {completed}/{total}` (small-caps, muted).
- One row per todo:
  - Status icon column (12 px): `☐` pending, `▶` in_progress (cyan), `☑` completed (muted, strike).
  - Title — `subject` in body color, in_progress in accent color, completed strikethrough/muted.
  - Description — second line, smaller, muted, truncated to one line by default.
- Max height: `min(35vh, 280px)`; scroll inside.
- Padding/border to visually separate from message list (top border) and composer (bottom border).

### Why pinned, not inline

A pinned panel stays visible regardless of where the user has scrolled the message list. The user explicitly asked for "pinned on the bottom below streamed activities" — the streamed activities being the assistant text/tool calls in the message list, and the panel sitting below it.

## Files Touched

### Rust
- `crates/core/src/session.rs` — busy tracker task, caffeinate handle, SessionConfig extension, CLI flags
- `crates/core/src/manager.rs` — pass caffeinate Arc into spawn; drop acquire/release from spawn/close
- `crates/core/tests/manager.rs` — rewrite for busy-based caffeinate
- `crates/app/src/state.rs` — model/effort fields on Manifest
- `crates/app/src/commands.rs` — get_preferences, set_preferences, plumb model/effort through spawn_session
- `crates/app/tests/state.rs` — round-trip new fields

### Frontend
- `ui/src/ipc/types.ts` — Todo, Preferences, model/effort on spawn args
- `ui/src/ipc/bridge.ts` — getPreferences, setPreferences
- `ui/src/state/session-store.ts` — todos signal
- `ui/src/render/ToolView.tsx` — NEW
- `ui/src/render/TodoPanel.tsx` — NEW
- `ui/src/render/Message.tsx` — use ToolBlock
- `ui/src/panes/CenterPane.tsx` — mount TodoPanel, model/effort badge
- `ui/src/panes/LeftPane.tsx` — model/effort dropdowns
- `ui/src/App.tsx` — load + apply preferences to spawn

## Risks

- The busy tracker subscribes to a `broadcast::Receiver`, which can lag if events fire faster than the tracker consumes (channel cap 1024). If lag occurs, we may double-acquire. Mitigate with `is_busy` atomic — `swap(true, SeqCst)` returns prior state, so we only call `acquire()` if previously false.
- Effort `xhigh`/`max` may not be supported by every model. We rely on the CLI to error if mis-combined; the resulting error surfaces through the existing spawn-error toast.
