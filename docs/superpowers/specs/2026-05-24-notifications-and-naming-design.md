# Notifications & Chat Naming

## Scope

Two features for CCShell:
1. **Session notifications** — alert the user when a background session finishes or asks a question
2. **Chat naming** — auto-generate session names from conversation content, with manual override

---

## 1. Session Notifications

### Triggers

A notification fires when a non-active session transitions to a state requiring user attention:

- **Turn complete**: `Result` event received → session status becomes `idle`
- **Question asked**: `Tool` event where `name` matches `AskUser*` or `AskFollowupQuestion`

### Routing

| App focused? | Session active? | Action |
|---|---|---|
| No | — | macOS system notification |
| Yes | No (different session active) | In-app popup (bottom-left) |
| Yes | Yes | Nothing (user is watching) |

### macOS System Notification

- Use `@tauri-apps/plugin-notification` (Tauri v2 plugin)
- Title: session name
- Body: "Finished" or "Asking a question"
- On click: focus app window + switch to that session (via Tauri deep link or window focus + `setActiveId`)

### In-App Popup

- Positioned bottom-left, outside the three-pane layout (absolute/fixed)
- Small card: session name + status ("done" / "needs input")
- Auto-dismiss after 8 seconds, or click to navigate to the session
- Stack up to 3 notifications (oldest at bottom); overflow silently drops the oldest
- Subtle slide-in animation (CSS transition)

### Focus Detection

- Window focus: `appWindow.onFocusChanged()` from `@tauri-apps/api/window` — track `isWindowFocused` signal
- Active session: existing `activeId()` signal in App.tsx

### Where in Code

- **App.tsx**: Add an effect that watches all session stores. When any store's status transitions from `thinking|tool` → `idle` (or a Tool event with AskUser name arrives), and the session is not the active one, fire the notification.
- **New component**: `ui/src/render/SessionNotification.tsx` — the bottom-left popup stack
- **Tauri plugin**: Add `tauri-plugin-notification` to `crates/app/Cargo.toml` and `tauri.conf.json`

---

## 2. Chat Naming

### Auto-Generation

Trigger: When the first `Assistant` event arrives for a session that still has its default name (`session-{N}`).

Logic:
1. Take the first user message text from the session's message store
2. Strip leading whitespace/newlines
3. Extract the first sentence (up to first `.`, `?`, `!`, or newline), capped at 50 chars
4. Trim to last word boundary if truncated
5. Update the session name in the store and persist to manifest

### Manual Override

- **Double-click** the session name in the left pane → transforms into an inline `<input>` element
- **Enter** or **blur** saves the new name
- **Escape** cancels (reverts to previous name)
- Empty input reverts to previous name (no blank names allowed)

### Backend

New Tauri command: `rename_session(id: String, name: String)`
- Updates the session's name in the in-memory `SessionManager`
- Persists to `Manifest.sessions[].name` in state.json

### Where in Code

- **LeftPane.tsx**: Add editable name inline (double-click handler, input element)
- **session-store.ts**: Add `setName(name: string)` or update via existing store setter
- **bridge.ts**: Add `renameSession(id, name)` IPC wrapper
- **crates/app/src/commands.rs**: New `rename_session` command
- **crates/app/src/state.rs**: Update manifest persistence

---

## Non-Goals

- No rate limit display
- No context window percentage calculation
- No sound/audio notifications
- No notification preferences/settings (can add later)
