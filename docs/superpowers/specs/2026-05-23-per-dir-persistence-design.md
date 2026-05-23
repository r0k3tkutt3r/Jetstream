# Per-Directory Persistence, Folder Picker, and Project Commands

**Date:** 2026-05-23
**Status:** Approved

## Goals

1. Remove the Agents list from the LeftPane (the section under "Agents" header that enumerates `.md` subagent files).
2. Persist user context between launches:
   - Remember the last working directory.
   - Filter the Sessions list to only sessions whose `cwd` matches the current working directory.
   - Saved-but-inactive sessions are clickable and re-attach via the existing `resume_session` flow.
3. `Cmd+O` opens the native macOS folder picker; the chosen path becomes the current working directory.
4. Per-directory Run / Test / Build commands with three one-click buttons. Output appears in a dismissable toast showing exit code + tail of combined stdout/stderr.

## Non-Goals

- Streaming live command output into the UI (toast tail only).
- Cross-platform folder-picker behavior tuning (macOS is the only target right now).
- Removing the `list_agents` Tauri command — it stays on the backend, just unreferenced in the UI.

## Backend Changes

### `crates/app/src/state.rs` — Manifest extension

Add per-directory config and last-used cwd:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DirectoryConfig {
    #[serde(default)]
    pub run_command: String,
    #[serde(default)]
    pub test_command: String,
    #[serde(default)]
    pub build_command: String,
}

pub struct Manifest {
    // existing
    pub sessions: Vec<ManifestSession>,
    pub window: WindowState,
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    // new
    #[serde(default)]
    pub last_cwd: Option<String>,
    #[serde(default)]
    pub directories: std::collections::HashMap<String, DirectoryConfig>,
}
```

All new fields use `#[serde(default)]`, so existing on-disk manifests continue to load.

### `crates/app/src/commands.rs` — New Tauri commands

```rust
list_sessions_for_cwd(cwd: String) -> Vec<SessionSummary>
get_last_cwd() -> Option<String>
set_last_cwd(cwd: String) -> ()
get_directory_config(cwd: String) -> DirectoryConfig
set_directory_config(cwd: String, cfg: DirectoryConfig) -> ()
pick_directory() -> Option<String>             // tauri-plugin-dialog
run_directory_command(cwd: String, kind: String) -> CommandOutput
```

- `list_sessions_for_cwd` merges the live session list (`manager.list()`) with `manifest.sessions`, filtered to entries whose `cwd == requested cwd`. Active entries (ones currently in the manager) shadow manifest entries with the same id.
- `run_directory_command` resolves the command string from the manifest's `DirectoryConfig` (key on `cwd`), spawns `sh -c "<command>"` with the given `cwd` as working directory, captures stdout + stderr, returns:

  ```rust
  struct CommandOutput {
      exit_code: i32,
      stdout_tail: String,  // last 15 lines of stdout
      stderr_tail: String,  // last 15 lines of stderr
      command: String,      // the actual command that ran, for the toast header
  }
  ```

  If the command field for that kind is empty, return an error string `"no <kind> command configured for this directory"`.

- `pick_directory` uses `tauri-plugin-dialog`'s file dialog with `pick_folder()`. Returns `Some(path)` or `None` if canceled.

### `crates/app/Cargo.toml` — new dependency

```toml
tauri-plugin-dialog = "2"
```

### `crates/app/src/main.rs`

- Register the new commands in `invoke_handler!`.
- Initialize `tauri-plugin-dialog` via `.plugin(tauri_plugin_dialog::init())`.

### `crates/app/capabilities/default.json`

Add permissions:

```json
"dialog:default",
"dialog:allow-open"
```

### `crates/app/tests/state.rs`

Add round-trip tests covering `last_cwd` and `directories` serialization, plus a forward-compat test that loads a manifest written by the previous schema (without the new fields).

## Frontend Changes

### `ui/src/ipc/types.ts`

```ts
export interface DirectoryConfig {
  run_command: string;
  test_command: string;
  build_command: string;
}
export interface CommandOutput {
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  command: string;
}
export type CommandKind = "run" | "test" | "build";
```

### `ui/src/ipc/bridge.ts`

Add invocations for the 7 new commands.

### `ui/src/App.tsx`

- On mount: call `getLastCwd()`; if present, set as `currentCwd` (overriding the home dir default).
- When `currentCwd` changes via the existing setter, call `setLastCwd(cwd)` (fire-and-forget).
- Add `Cmd+O` to the global keybind handler:

  ```ts
  if (e.metaKey && e.key === "o") { e.preventDefault(); void pickAndSetCwd(); return; }
  ```

  `pickAndSetCwd` invokes `pick_directory` and, on `Some`, sets `currentCwd`.

- Remove the `onSelectAgent: () => {}` prop from the Layout's `left` props.
- Toast state extended to display command output: same component family as `spawnError`. Keep at the same `top: 16px / right: 16px` slot. When command finishes, push `{title, body, kind: 'success'|'error'}` and auto-dismiss after 8 seconds (or on click).

### `ui/src/panes/LeftPane.tsx`

- Remove the entire Agents section (the `<div style={{ "border-top": ...}}>` block beginning with `<div class="section-label">` containing "Agents", along with its filter input and `<For each={filteredAgents()}>`).
- Remove `agents`, `filter`, `filteredAgents`, and the `onSelectAgent` prop.
- Replace the Sessions list with sessions returned by `list_sessions_for_cwd(props.cwd)`, fetched via `createResource(() => props.cwd, (cwd) => ipc.listSessionsForCwd(cwd))`. Re-fetches automatically when `cwd` changes.
  - Active sessions render as today.
  - Manifest-only sessions render the same way; clicking calls `resume_session({ id, cwd, name })` then updates active selection.
  - Distinguish visually with a subtle "saved" tag for non-active entries.
- Add a "Project" section above (or below — TBD by visual fit; default: below) the Sessions section:

  ```
  PROJECT
  [▶ Run] [✓ Test] [⚙ Build]
  Run command   [text input]
  Test command  [text input]
  Build command [text input]
  ```

  - The three text inputs are seeded from `get_directory_config(cwd)` via `createResource(() => props.cwd, ...)`.
  - Edits are debounced (~400 ms) and saved via `set_directory_config(cwd, cfg)`.
  - Button click invokes `run_directory_command(cwd, kind)`. Disable the button if the corresponding input is empty.
  - Result fed to the App-level toast (success: green-tinted, error: red-tinted).

### `ui/src/panes/Layout.tsx`

- Drop the `onSelectAgent` field from `LeftPaneProps` consumption (no code change here beyond what props get passed through — the LeftPane interface itself loses the field).

### CSS

- No grid changes — right pane stays.
- Add small styles for the Project section and the three buttons (reuse the same input styling as the cwd input). Buttons get a tight row with `gap: 6px`.

## Session Restore Semantics

When `currentCwd` changes:
1. UI reads `list_sessions_for_cwd(cwd)`.
2. If the previously `activeId` is no longer in the filtered list, clear `activeId` (center pane returns to its "Pick or start a session" empty state).
3. Active sessions stay running in the background — switching cwd doesn't close them.

When clicking a saved (non-active) session:
1. Call `resume_session({ id, cwd, name })`.
2. Subscribe to its events as `spawn_session` does.
3. Set as `activeId`.

When command runs:
1. Backend spawns `sh -c "<command>"` with the dir as cwd, captures output (no streaming).
2. Frontend shows toast with exit code + tail.
3. No state mutation beyond the toast.

## Testing

- `crates/app/tests/state.rs`: extend with manifest schema migration test (old JSON loads OK with defaults for new fields) and round-trip for `directories` map + `last_cwd`.
- Manual smoke:
  - Set cwd to project A, spawn session, close app, re-launch — last cwd restored, session appears in list, click → resumes.
  - Switch cwd to project B — only B's sessions show.
  - Configure run/test/build for project A — verify persistence across restart.
  - Run with empty command field — button disabled.
  - Run command that exits non-zero — toast shows error styling + stderr tail.
  - Cmd+O — folder picker opens, selected dir becomes current cwd.

## Out-of-scope but Noted

- Live streaming output panel (deferred; toast covers v1).
- Per-project metadata beyond commands (env vars, last branch, etc.).
- Windows/Linux folder-picker testing — `tauri-plugin-dialog` is cross-platform, but we are only validating on macOS for this iteration.
