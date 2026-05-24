# Notifications & Chat Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session notifications (OS-level + in-app) when a background session finishes or asks a question, and auto-generate chat names from conversation content with manual override.

**Architecture:** Frontend-driven notification routing using a reactive effect in App.tsx that watches all session stores for status transitions. OS notifications via `tauri-plugin-notification`. In-app notifications via a new bottom-left popup component. Chat naming derives titles client-side from the first user message when the first assistant response arrives.

**Tech Stack:** SolidJS, Tauri v2, tauri-plugin-notification, @tauri-apps/plugin-notification

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `crates/app/Cargo.toml` | Modify | Add tauri-plugin-notification dependency |
| `crates/app/src/main.rs` | Modify | Register notification plugin |
| `crates/app/tauri.conf.json` | Modify | Add notification permission |
| `crates/app/src/commands.rs` | Modify | Add `rename_session` command |
| `ui/package.json` | Modify | Add @tauri-apps/plugin-notification |
| `ui/src/render/SessionNotification.tsx` | Create | Bottom-left in-app notification popup stack |
| `ui/src/App.tsx` | Modify | Window focus tracking, notification routing effect, auto-naming, render notification component |
| `ui/src/state/session-store.ts` | Modify | Add mutable `name` signal + `setName` method |
| `ui/src/ipc/bridge.ts` | Modify | Add `renameSession` IPC wrapper |
| `ui/src/panes/LeftPane.tsx` | Modify | Add double-click-to-rename inline edit |

---

### Task 1: Add Tauri Notification Plugin (Backend)

**Files:**
- Modify: `crates/app/Cargo.toml`
- Modify: `crates/app/src/main.rs`
- Modify: `crates/app/tauri.conf.json`

- [ ] **Step 1: Add notification plugin dependency to Cargo.toml**

In `crates/app/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register the plugin in main.rs**

In `crates/app/src/main.rs`, add after the dialog plugin line:

```rust
        .plugin(tauri_plugin_notification::init())
```

So it reads:
```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Add notification capability to tauri.conf.json**

Create `crates/app/capabilities/default.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2/capabilities",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "notification:default",
    "notification:allow-notify",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission"
  ]
}
```

- [ ] **Step 4: Install the frontend npm package**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm add @tauri-apps/plugin-notification`

- [ ] **Step 5: Verify build compiles**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell && cargo build -p ccshell-app`
Expected: Compiles successfully (notification plugin registered).

- [ ] **Step 6: Commit**

```bash
git add crates/app/Cargo.toml crates/app/src/main.rs crates/app/capabilities/default.json ui/package.json ui/pnpm-lock.yaml
git commit -m "feat: add tauri-plugin-notification for OS-level notifications"
```

---

### Task 2: Add `rename_session` Backend Command

**Files:**
- Modify: `crates/app/src/commands.rs`
- Modify: `crates/app/src/main.rs`

- [ ] **Step 1: Add the `rename_session` command to commands.rs**

Add this function after the `close_session` command (around line 224):

```rust
#[tauri::command]
pub fn rename_session(
    manager: State<'_, Arc<SessionManager>>,
    manifest: State<'_, Mutex<Manifest>>,
    manifest_path: State<'_, PathBuf>,
    id: String,
    name: String,
) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("name cannot be empty".into());
    }
    // Update in-memory session if it exists
    if let Ok(uuid) = id.parse::<uuid::Uuid>() {
        if let Some(session) = manager.get(uuid) {
            // Session struct name is pub but not mutable via the Arc; we only
            // persist the name in the manifest which is the source of truth
            // for session metadata.
            let _ = session;
        }
    }
    // Persist to manifest
    let mut m = manifest.lock().unwrap();
    if let Some(s) = m.sessions.iter_mut().find(|s| s.id == id) {
        s.name = trimmed;
    }
    save_to(&manifest_path, &m).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the command in main.rs**

Add `commands::rename_session,` to the `invoke_handler` list in `main.rs`:

```rust
            commands::close_session,
            commands::rename_session,
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell && cargo build -p ccshell-app`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
git add crates/app/src/commands.rs crates/app/src/main.rs
git commit -m "feat: add rename_session IPC command"
```

---

### Task 3: Make Session Name Mutable in Frontend Store

**Files:**
- Modify: `ui/src/state/session-store.ts`
- Modify: `ui/src/ipc/bridge.ts`

- [ ] **Step 1: Add mutable name signal to session store**

In `ui/src/state/session-store.ts`, change the `SessionStore` interface — replace the `name: string` field with signals:

```typescript
export interface SessionStore {
  id: string;
  name: Accessor<string>;
  setName: (n: string) => void;
  cwd: string;
  // ... rest unchanged
}
```

- [ ] **Step 2: Implement the name signal in createSessionStore**

In the `createSessionStore` function body, add after the existing signal declarations (around line 84):

```typescript
const [name, setNameSignal] = createSignal<string>(init.name);
const setName = (n: string) => { setNameSignal(n); };
```

Then in the return object, change:
```typescript
    name: init.name,
```
to:
```typescript
    name,
    setName,
```

- [ ] **Step 3: Add renameSession to the IPC bridge**

In `ui/src/ipc/bridge.ts`, add to the `ipc` object:

```typescript
  renameSession: (id: string, name: string) =>
    invoke<void>("rename_session", { id, name }),
```

- [ ] **Step 4: Fix all references to `store.name` that now need `store.name()`**

Since `name` is now a signal accessor, update all call sites:
- `ui/src/panes/LeftPane.tsx` — already reads from `SessionSummary.name` (string), not the store directly, so no change needed there
- `ui/src/panes/CenterPane.tsx` — if it reads `session.name`, change to `session.name()`
- `ui/src/App.tsx` — the `newSession` passes `name` as a string for spawn args, which is fine; but anywhere displaying the store name needs `()`

Check all files that import or use `SessionStore`:

Run: `grep -rn "\.name" ui/src/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v "\.name(" | grep store`

Fix each occurrence.

- [ ] **Step 5: Verify frontend compiles**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm build`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/state/session-store.ts ui/src/ipc/bridge.ts ui/src/panes/CenterPane.tsx ui/src/App.tsx
git commit -m "feat: make session name a mutable signal with IPC rename support"
```

---

### Task 4: Auto-Generate Chat Names

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add auto-naming logic in the session event subscription**

In `App.tsx`, add a helper function for generating names from the first user message:

```typescript
function deriveSessionName(messages: Message[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !firstUser.content.trim()) return null;
  let text = firstUser.content.trim().replace(/\n/g, " ");
  // Take first sentence or first 50 chars
  const sentenceEnd = text.search(/[.?!]/);
  if (sentenceEnd > 0 && sentenceEnd < 50) {
    text = text.slice(0, sentenceEnd + 1);
  } else if (text.length > 50) {
    text = text.slice(0, 50);
    const lastSpace = text.lastIndexOf(" ");
    if (lastSpace > 30) text = text.slice(0, lastSpace);
    text += "…";
  }
  return text;
}
```

- [ ] **Step 2: Add an effect that watches for first assistant message**

Add an effect in App.tsx that runs after session events. When a session's messages change from having no assistant messages to having one, and the name still matches `session-\d+`, auto-name it:

```typescript
createEffect(() => {
  const allStores = stores();
  for (const [id, store] of Object.entries(allStores)) {
    const msgs = store.messages();
    const currentName = store.name();
    // Only auto-name if it still has the default name
    if (!/^session-\d+$/.test(currentName)) continue;
    // Need at least one assistant message
    const hasAssistant = msgs.some((m) => m.role === "assistant");
    if (!hasAssistant) continue;
    const derived = deriveSessionName(msgs);
    if (derived) {
      store.setName(derived);
      void ipc.renameSession(id, derived);
    }
  }
});
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat: auto-generate session names from first user message"
```

---

### Task 5: Manual Rename in Left Pane (Double-Click)

**Files:**
- Modify: `ui/src/panes/LeftPane.tsx`

- [ ] **Step 1: Add editing state and rename handler**

Add these props to `LeftPaneProps`:

```typescript
  onRenameSession: (id: string, name: string) => void;
```

Inside the `LeftPane` component, add state for the editing session:

```typescript
const [editingId, setEditingId] = createSignal<string | null>(null);
const [editValue, setEditValue] = createSignal("");
```

- [ ] **Step 2: Replace the session name span with conditional inline input**

Replace the name display in the session list item (line ~191). Change:

```tsx
<span style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{s.name || "(unnamed)"}</span>
```

To:

```tsx
<Show when={editingId() === s.id} fallback={
  <span
    onDblClick={(ev) => {
      ev.stopPropagation();
      setEditingId(s.id);
      setEditValue(s.name || "");
    }}
    style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
    title="double-click to rename"
  >{s.name || "(unnamed)"}</span>
}>
  <input
    ref={(el) => setTimeout(() => el.focus(), 0)}
    value={editValue()}
    onInput={(e) => setEditValue(e.currentTarget.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        const val = editValue().trim();
        if (val) props.onRenameSession(s.id, val);
        setEditingId(null);
      } else if (e.key === "Escape") {
        setEditingId(null);
      }
    }}
    onBlur={() => {
      const val = editValue().trim();
      if (val && val !== s.name) props.onRenameSession(s.id, val);
      setEditingId(null);
    }}
    onClick={(e) => e.stopPropagation()}
    spellcheck={false}
    style={{
      flex: 1,
      "font-size": "11px",
      padding: "1px 4px",
      background: "var(--bg-2)",
      color: "var(--text-1)",
      border: "1px solid var(--accent)",
      "border-radius": "2px",
      outline: "none",
      "min-width": 0,
    }}
  />
</Show>
```

- [ ] **Step 3: Wire up the rename prop in App.tsx Layout**

In `App.tsx`, add to the `left` prop object:

```typescript
onRenameSession: (id, name) => {
  const store = stores()[id];
  if (store) {
    store.setName(name);
    void ipc.renameSession(id, name);
  }
},
```

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/panes/LeftPane.tsx ui/src/App.tsx
git commit -m "feat: double-click to rename sessions in left pane"
```

---

### Task 6: Window Focus Tracking

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add window focus signal**

At the top of the App component (after existing signal declarations), add:

```typescript
const [windowFocused, setWindowFocused] = createSignal(document.hasFocus());
```

- [ ] **Step 2: Set up focus/blur listeners**

Add an effect to track window focus:

```typescript
createEffect(() => {
  const onFocus = () => setWindowFocused(true);
  const onBlur = () => setWindowFocused(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  onCleanup(() => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat: track window focus state for notification routing"
```

---

### Task 7: Create In-App Notification Popup Component

**Files:**
- Create: `ui/src/render/SessionNotification.tsx`

- [ ] **Step 1: Create the SessionNotification component**

Create `ui/src/render/SessionNotification.tsx`:

```typescript
import { Component, For, createSignal, onCleanup } from "solid-js";

export interface SessionNotif {
  id: number;
  sessionId: string;
  sessionName: string;
  reason: "done" | "question";
  timestamp: number;
}

export interface SessionNotificationProps {
  notifications: SessionNotif[];
  onDismiss: (id: number) => void;
  onClick: (sessionId: string) => void;
}

export const SessionNotificationStack: Component<SessionNotificationProps> = (props) => {
  return (
    <div style={{
      position: "fixed",
      bottom: "16px",
      left: "16px",
      display: "flex",
      "flex-direction": "column-reverse",
      gap: "8px",
      "z-index": 9999,
      "max-width": "300px",
      "pointer-events": "none",
    }}>
      <For each={props.notifications.slice(0, 3)}>
        {(n) => (
          <div
            onClick={() => props.onClick(n.sessionId)}
            style={{
              "pointer-events": "auto",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              "border-radius": "6px",
              padding: "10px 12px",
              cursor: "pointer",
              "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
              animation: "slideInLeft 0.2s ease-out",
            }}
          >
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
              <span style={{ "font-size": "11px", "font-weight": "bold", color: "var(--text-1)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "200px" }}>
                {n.sessionName}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); props.onDismiss(n.id); }}
                style={{ "font-size": "12px", color: "var(--text-3)", cursor: "pointer", padding: "0 4px" }}
              >×</span>
            </div>
            <div style={{ "font-size": "10px", color: "var(--text-2)", "margin-top": "2px" }}>
              {n.reason === "done" ? "Session finished" : "Asking a question"}
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
```

- [ ] **Step 2: Add the CSS animation to the app's global styles**

In `ui/src/index.css` (or wherever global styles live), add:

```css
@keyframes slideInLeft {
  from { transform: translateX(-20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/render/SessionNotification.tsx ui/src/index.css
git commit -m "feat: add in-app session notification popup component"
```

---

### Task 8: Notification Routing Logic

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Import notification dependencies**

At the top of App.tsx, add:

```typescript
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { SessionNotificationStack, type SessionNotif } from "./render/SessionNotification";
```

- [ ] **Step 2: Add notification state**

After the existing signals in the App component, add:

```typescript
const [notifications, setNotifications] = createSignal<SessionNotif[]>([]);
let notifCounter = 0;
```

- [ ] **Step 3: Add notification helper functions**

```typescript
const pushNotification = (sessionId: string, sessionName: string, reason: "done" | "question") => {
  const id = ++notifCounter;
  setNotifications((cur) => [...cur.slice(-2), { id, sessionId, sessionName, reason, timestamp: Date.now() }]);
  setTimeout(() => setNotifications((cur) => cur.filter((n) => n.id !== id)), 8000);
};

const dismissNotification = (id: number) => {
  setNotifications((cur) => cur.filter((n) => n.id !== id));
};

const handleNotifClick = (sessionId: string) => {
  // Find the session summary and activate it
  setActiveId(sessionId);
  setNotifications([]);
};

async function sendOsNotification(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  if (granted) {
    sendNotification({ title, body });
  }
}
```

- [ ] **Step 4: Add the notification routing effect**

This effect watches all session stores for status changes. It uses a `prevStatuses` map to detect transitions:

```typescript
const prevStatuses = new Map<string, SessionStatus>();

createEffect(() => {
  const allStores = stores();
  for (const [id, store] of Object.entries(allStores)) {
    const currentStatus = store.status();
    const prevStatus = prevStatuses.get(id);
    prevStatuses.set(id, currentStatus);

    // Skip if this is the active session — user is watching
    if (id === activeId()) continue;

    // Detect transition to idle (turn complete)
    if (currentStatus === "idle" && prevStatus && prevStatus !== "idle" && prevStatus !== "closed") {
      const name = store.name();
      if (!windowFocused()) {
        void sendOsNotification(name, "Session finished");
      } else {
        pushNotification(id, name, "done");
      }
    }
  }
});
```

- [ ] **Step 5: Add AskUser tool detection in the session store event handler**

We need to detect AskUser tool calls. The cleanest way is to add the detection in the existing event handling. In the `handleEvent` for Tool events, we already process tool names. We'll add a callback mechanism.

In App.tsx, when attaching a store, wrap the event handler to also check for AskUser tools:

After `const store = createSessionStore(s);` in `attachStore`, add:

```typescript
const originalHandler = store.handleEvent;
store.handleEvent = (e: SessionEvent) => {
  originalHandler(e);
  // Check for AskUser tool calls
  if (e.type === "Tool" && /^Ask(User|Followup)/i.test(e.name)) {
    if (s.id !== activeId()) {
      const name = store.name();
      if (!windowFocused()) {
        void sendOsNotification(name, "Asking a question");
      } else {
        pushNotification(s.id, name, "question");
      }
    }
  }
};
```

- [ ] **Step 6: Render the notification stack**

In the App component's JSX return, add before the closing `</>`:

```tsx
<SessionNotificationStack
  notifications={notifications()}
  onDismiss={dismissNotification}
  onClick={handleNotifClick}
/>
```

- [ ] **Step 7: Verify frontend builds**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm build`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat: notification routing - OS notifications when unfocused, in-app popups when in different session"
```

---

### Task 9: Wire Up Layout Props for Rename

**Files:**
- Modify: `ui/src/panes/Layout.tsx`

- [ ] **Step 1: Pass onRenameSession through Layout**

Check `Layout.tsx` to see how left pane props are forwarded. Add `onRenameSession` to the left pane props interface and pass it through.

In `Layout.tsx`, the left pane props type should include:
```typescript
onRenameSession: (id: string, name: string) => void;
```

Pass it down to `<LeftPane ... onRenameSession={props.left.onRenameSession} />`.

- [ ] **Step 2: Verify build**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell/ui && pnpm build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add ui/src/panes/Layout.tsx
git commit -m "feat: wire onRenameSession prop through Layout"
```

---

### Task 10: Final Integration Test

- [ ] **Step 1: Full build verification**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell && cargo build -p ccshell-app && cd ui && pnpm build`
Expected: Both backend and frontend compile cleanly.

- [ ] **Step 2: Launch app with `cargo tauri dev`**

Run: `cd /Users/kushmodi/Coding/CursorProjects/CCShell && cargo tauri dev`
Expected: App launches without errors.

- [ ] **Step 3: Test auto-naming**

1. Create a new session
2. Send a message like "Help me refactor the authentication module"
3. Once Claude responds, the session name in the left pane should update to something like "Help me refactor the authentication module" (truncated)

- [ ] **Step 4: Test manual rename**

1. Double-click the session name in the left pane
2. Type a new name and press Enter
3. Verify the name persists after restart

- [ ] **Step 5: Test in-app notifications**

1. Open a second session
2. Send a message in session 1, then quickly switch to session 2
3. When session 1 finishes, a bottom-left popup should appear
4. Click the popup to switch back to session 1

- [ ] **Step 6: Test OS notifications**

1. Start a task in a session
2. Switch to another macOS app (unfocus CCShell)
3. When the session finishes, a macOS notification should appear

- [ ] **Step 7: Commit any final fixes**

```bash
git add -A
git commit -m "fix: integration fixes for notifications and naming"
```
