import { Component, For, Show, createEffect, createSignal, getOwner, runWithOwner, onCleanup } from "solid-js";
import { Layout } from "./panes/Layout";
import { Settings } from "./settings/Settings";
import { LiveToast } from "./render/LiveToast";
import { CommandTerminal } from "./render/CommandTerminal";
import { SessionNotificationStack, type SessionNotif } from "./render/SessionNotification";
import { ipc, subscribeSession, subscribeCommandOutput, subscribeCommandExit } from "./ipc/bridge";
import { createSessionStore, type SessionStore, type Message } from "./state/session-store";
import { dispatchSlash } from "./composer/slash-handlers";
import type { CommandKind, SessionEvent, SessionSummary } from "./ipc/types";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

interface Toast {
  id: number;
  kind: "success" | "error";
  title: string;
  body: string;
}

function deriveSessionName(messages: Message[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !firstUser.content.trim()) return null;
  let text = firstUser.content.trim().replace(/\n/g, " ");
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

export const App: Component = () => {
  const owner = getOwner();
  const [stores, setStores] = createSignal<Record<string, SessionStore>>({});
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [showLeft, setShowLeft] = createSignal(true);
  const [showRight, setShowRight] = createSignal(true);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [theme, setTheme] = createSignal<"dark" | "light">("dark");
  const [fontFamily, setFontFamily] = createSignal("JetBrains Mono");
  const [fontSize, setFontSize] = createSignal(13);
  const [currentCwd, setCurrentCwd] = createSignal<string>("");
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [model, setModel] = createSignal<string>("sonnet");
  const [effort, setEffort] = createSignal<string>("medium");
  let prefsLoaded = false;
  const [cmdKind, setCmdKind] = createSignal<CommandKind | null>(null);
  const [cmdCommand, setCmdCommand] = createSignal("");
  const [cmdLines, setCmdLines] = createSignal<string[]>([]);
  const [cmdExitCode, setCmdExitCode] = createSignal<number | undefined>(undefined);
  const [cmdExpanded, setCmdExpanded] = createSignal(false);
  const [cmdRunning, setCmdRunning] = createSignal(false);
  let cmdOutputListeners: Array<(data: number[]) => void> = [];
  let autoDismissTimer: ReturnType<typeof setTimeout> | undefined;
  let toastCounter = 0;

  // Notification state
  const [windowFocused, setWindowFocused] = createSignal(document.hasFocus());
  const [notifications, setNotifications] = createSignal<SessionNotif[]>([]);
  let notifCounter = 0;

  const pushToast = (kind: "success" | "error", title: string, body: string) => {
    const id = ++toastCounter;
    setToasts((cur) => [...cur, { id, kind, title, body }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 8000);
  };
  const dismissToast = (id: number) =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  const pushNotification = (sessionId: string, sessionName: string, reason: "done" | "question") => {
    const id = ++notifCounter;
    setNotifications((cur) => [...cur.slice(-2), { id, sessionId, sessionName, reason, timestamp: Date.now() }]);
    setTimeout(() => setNotifications((cur) => cur.filter((n) => n.id !== id)), 8000);
  };

  const dismissNotification = (id: number) => {
    setNotifications((cur) => cur.filter((n) => n.id !== id));
  };

  const handleNotifClick = (sessionId: string) => {
    setActiveId(sessionId);
    setNotifications([]);
  };

  // Subscribe to command events
  void (async () => {
    const unOutput = await subscribeCommandOutput((data) => {
      const text = new TextDecoder().decode(new Uint8Array(data));
      const newLines = text.split("\n");
      setCmdLines((prev) => {
        const combined = [...prev];
        if (combined.length > 0 && newLines.length > 0) {
          combined[combined.length - 1] += newLines[0];
          combined.push(...newLines.slice(1));
        } else {
          combined.push(...newLines);
        }
        return combined.slice(-200);
      });
      for (const listener of cmdOutputListeners) {
        listener(data);
      }
    });
    const unExit = await subscribeCommandExit((exitCode, _command) => {
      setCmdRunning(false);
      setCmdExitCode(exitCode);
      if (!cmdExpanded()) {
        if (autoDismissTimer) clearTimeout(autoDismissTimer);
        autoDismissTimer = setTimeout(() => {
          autoDismissTimer = undefined;
          if (!cmdExpanded()) {
            setCmdKind(null);
            setCmdLines([]);
            setCmdExitCode(undefined);
          }
        }, 8000);
      }
    });
    onCleanup(() => { unOutput(); unExit(); });
  })();

  const handleRunCommand = async (kind: CommandKind) => {
    const cwd = currentCwd();
    if (!cwd) return;
    if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = undefined; }
    setCmdKind(kind);
    setCmdCommand("");
    setCmdLines([]);
    setCmdExitCode(undefined);
    setCmdExpanded(false);
    setCmdRunning(true);
    try {
      const command = await ipc.startCommand(cwd, kind);
      setCmdCommand(command);
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
      pushToast("error", `${kind} failed`, msg);
      setCmdKind(null);
      setCmdRunning(false);
    }
  };

  const handleKillCommand = () => {
    ipc.killCommand().catch(() => {});
  };

  // Restore last cwd, falling back to home dir.
  void (async () => {
    const last = await ipc.getLastCwd().catch(() => null);
    if (last && !currentCwd()) {
      setCurrentCwd(last);
    } else if (!currentCwd()) {
      const home = await ipc.getDefaultCwd().catch(() => "");
      if (home && !currentCwd()) setCurrentCwd(home);
    }

    const prefs = await ipc.getPreferences().catch(() => null);
    if (prefs) {
      if (prefs.model) setModel(prefs.model);
      if (prefs.effort) setEffort(prefs.effort);
    }
    prefsLoaded = true;
  })();

  // Persist cwd when it changes (skip the empty initial value).
  createEffect(() => {
    const cwd = currentCwd();
    if (cwd) void ipc.setLastCwd(cwd).catch(() => {});
  });

  // Persist model/effort whenever they change after initial load.
  createEffect(() => {
    const m = model();
    const e = effort();
    if (!prefsLoaded) return;
    void ipc.setPreferences({ model: m, effort: e }).catch(() => {});
  });

  // Window focus tracking for notification routing
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

  // (Notification routing is handled in the wrappedHandler inside attachStore)

  // Clear activeId if it points to a session not in the current cwd.
  createEffect(() => {
    const id = activeId();
    if (!id) return;
    const store = stores()[id];
    if (!store) return;
    if (store.cwd !== currentCwd()) {
      // session belongs to a different cwd — keep its store running but unselect
      setActiveId(null);
    }
  });

  const attachStore = async (s: SessionSummary): Promise<SessionStore> => {
    const store = createSessionStore(s);
    let wasBusy = false;
    let autoNamed = false;
    const wrappedHandler = (e: SessionEvent) => {
      store.handleEvent(e);
      if (e.type === "Assistant" || e.type === "Tool") wasBusy = true;
      // Notification: session finished
      if (e.type === "Result" && wasBusy) {
        wasBusy = false;
        if (s.id !== activeId()) {
          const nm = store.name();
          if (!windowFocused()) void sendOsNotification(nm, "Session finished");
          else pushNotification(s.id, nm, "done");
        }
      }
      // Notification: AskUser tool
      if (e.type === "Tool" && /^Ask(User|Followup)/i.test(e.name)) {
        if (s.id !== activeId()) {
          const nm = store.name();
          if (!windowFocused()) void sendOsNotification(nm, "Asking a question");
          else pushNotification(s.id, nm, "question");
        }
      }
    };
    // Auto-naming: watch status signal for idle transition
    // Use runWithOwner because attachStore is called from click handlers
    // which lack a SolidJS reactive owner
    runWithOwner(owner, () => {
      createEffect(() => {
        const st = store.status();
        if (autoNamed || st !== "idle") return;
        const currentName = store.name();
        if (!/^session-\d+$/.test(currentName)) return;
        const msgs: Message[] = [...store.messages()];
        if (!msgs.some((m) => m.role === "assistant")) return;
        const derived = deriveSessionName(msgs);
        if (derived) {
          autoNamed = true;
          store.setName(derived);
          void ipc.renameSession(s.id, derived);
        }
      });
    });
    const un = await subscribeSession(s.id, wrappedHandler);
    onCleanup(un);
    setStores({ ...stores(), [s.id]: store });
    return store;
  };

  const newSession = async () => {
    try {
      const s = await ipc.spawnSession({
        cwd: currentCwd(),
        name: `session-${Object.keys(stores()).length + 1}`,
        model: model(),
        effort: effort(),
      });
      await attachStore(s);
      setActiveId(s.id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
      console.error("spawn_session failed:", err);
      pushToast("error", "spawn_session failed", msg);
    }
  };

  const activateSession = async (s: SessionSummary) => {
    const existing = stores()[s.id];
    if (existing && existing.status() !== "closed" && existing.status() !== "error") {
      setActiveId(s.id);
      return;
    }
    if (existing) {
      setStores((cur) => {
        const next = { ...cur };
        delete next[s.id];
        return next;
      });
    }
    try {
      const fresh = await ipc.resumeSession({ id: s.id, cwd: s.cwd, name: s.name });
      await attachStore(fresh);
      setActiveId(fresh.id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
      console.error("resume_session failed:", err);
      pushToast("error", "resume_session failed", msg);
    }
  };

  const deleteSession = async (s: SessionSummary) => {
    try {
      await ipc.closeSession(s.id);
      setStores((cur) => {
        const next = { ...cur };
        delete next[s.id];
        return next;
      });
      if (activeId() === s.id) setActiveId(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err);
      console.error("close_session failed:", err);
      pushToast("error", "delete failed", msg);
    }
  };

  const clearAllSessions = async (sessions: SessionSummary[]) => {
    const results = await Promise.allSettled(sessions.map((s) => ipc.closeSession(s.id)));
    const failures = results.filter((r) => r.status === "rejected").length;
    const removedIds = new Set(
      sessions.filter((_, i) => results[i].status === "fulfilled").map((s) => s.id),
    );
    setStores((cur) => {
      const next = { ...cur };
      for (const id of removedIds) delete next[id];
      return next;
    });
    if (activeId() && removedIds.has(activeId()!)) setActiveId(null);
    setRefreshKey((k) => k + 1);
    if (failures > 0) {
      pushToast("error", "clear all partially failed", `${failures} of ${sessions.length} session(s) could not be closed.`);
    }
  };

  const pickCwd = async () => {
    try {
      const picked = await ipc.pickDirectory();
      if (picked) setCurrentCwd(picked);
    } catch (err) {
      console.error("pick_directory failed:", err);
    }
  };

  const sendNow = async (id: string, text: string) => {
    stores()[id]?.appendUserMessage(text);
    await ipc.sendUserMessage(id, text);
  };

  const send = async (text: string) => {
    const id = activeId();
    if (!id) return;
    const store = stores()[id];
    if (!store) return;

    store.pushHistory(text);

    if (text.trim().startsWith("/")) {
      const handled = await dispatchSlash(text, {
        store,
        model: model(),
        effort: effort(),
        setModel,
        setEffort,
      });
      if (handled) return;
      // Unhandled slash commands fall through — claude CLI processes them itself
      // and emits a synthetic assistant message with the real output.
    }

    const s = store.status();
    if (s === "thinking" || s === "tool") {
      store.enqueue(text);
      return;
    }
    await sendNow(id, text);
  };

  createEffect(() => {
    const id = activeId();
    if (!id) return;
    const store = stores()[id];
    if (!store) return;
    if (store.status() === "idle") {
      const items = store.drainQueue();
      if (items.length > 0) {
        (async () => {
          for (const t of items) {
            await sendNow(id, t);
          }
        })();
      }
    }
  });

  const cycle = async () => {
    const id = activeId();
    if (!id) return;
    const next = await ipc.cycleMode(id);
    stores()[id]?.setMode(next);
  };

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Tab") { e.preventDefault(); void cycle(); return; }
      if (e.metaKey && e.key === "b")   { e.preventDefault(); setShowLeft(!showLeft());  return; }
      if (e.metaKey && e.key === "j")   { e.preventDefault(); setShowRight(!showRight()); return; }
      if (e.metaKey && e.key === "n")   { e.preventDefault(); void newSession();         return; }
      if (e.metaKey && e.key === "o")   { e.preventDefault(); void pickCwd();            return; }
      if (e.metaKey && e.key === ",")   { e.preventDefault(); setSettingsOpen(true);     return; }
      if (e.ctrlKey && e.key === "c")   { e.preventDefault(); const id = activeId(); if (id) void ipc.interrupt(id); return; }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  const activeIdSet = () => new Set(Object.keys(stores()));

  return (
    <>
      <Layout
        showLeft={showLeft()}
        showRight={showRight()}
        left={{
          activeId: activeId(),
          activeIds: activeIdSet(),
          cwd: currentCwd(),
          refreshKey: refreshKey(),
          model: model(),
          effort: effort(),
          commandRunning: cmdKind(),
          onSetCwd: setCurrentCwd,
          onSetModel: setModel,
          onSetEffort: setEffort,
          onActivateSession: (s) => void activateSession(s),
          onDeleteSession: (s) => void deleteSession(s),
          onClearAllSessions: (list) => void clearAllSessions(list),
          onRunCommand: (kind) => void handleRunCommand(kind),
          onKillCommand: handleKillCommand,
          onNewSession: () => void newSession(),
          onPickCwd: () => void pickCwd(),
          onShowToast: pushToast,
          onRenameSession: (id: string, name: string) => {
            const store = stores()[id];
            if (store) {
              store.setName(name);
              void ipc.renameSession(id, name);
            }
          },
          getStoreName: (id: string) => {
            const store = stores()[id];
            return store ? store.name() : null;
          },
        }}
        center={{
          session: activeId() ? stores()[activeId()!] ?? null : null,
          model: model(),
          effort: effort(),
          onSend: (t) => void send(t),
          onDirectSend: (t) => { const id = activeId(); if (id) void sendNow(id, t); },
          onCycleMode: () => void cycle(),
          onInterrupt: () => { const id = activeId(); if (id) void ipc.interrupt(id); },
        }}
        right={{
          session: activeId() ? stores()[activeId()!] ?? null : null,
        }}
      />
      <Settings
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        theme={theme()}  onSetTheme={setTheme}
        fontFamily={fontFamily()} onSetFontFamily={setFontFamily}
        fontSize={fontSize()}     onSetFontSize={setFontSize}
      />
      <div style={{ position: "fixed", top: "16px", right: "16px", display: "flex", "flex-direction": "column", gap: "8px", "z-index": 9999, "max-width": "440px" }}>
        <Show when={cmdKind() && !cmdExpanded()}>
          <LiveToast
            kind={cmdKind()!}
            command={cmdCommand()}
            status={cmdRunning() ? "streaming" : "completed"}
            lines={cmdLines()}
            exitCode={cmdExitCode()}
            onExpand={() => {
              if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = undefined; }
              setCmdExpanded(true);
            }}
            onKill={handleKillCommand}
            onDismiss={() => {
              if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = undefined; }
              setCmdKind(null);
              setCmdLines([]);
              setCmdExitCode(undefined);
            }}
          />
        </Show>
        <For each={toasts()}>
          {(t) => (
            <div
              onClick={() => dismissToast(t.id)}
              style={{
                background: t.kind === "error" ? "#2a0f12" : "#0f2a16",
                color: t.kind === "error" ? "#fecaca" : "#bbf7d0",
                border: `1px solid ${t.kind === "error" ? "#7f1d1d" : "#166534"}`,
                "border-radius": "6px",
                padding: "10px 12px",
                "font-size": "11px",
                "font-family": "monospace",
                cursor: "pointer",
                "white-space": "pre-wrap",
                "max-height": "240px",
                "overflow-y": "auto",
              }}
              title="click to dismiss"
            >
              <div style={{ "font-weight": "bold", "margin-bottom": "4px" }}>{t.title}</div>
              {t.body}
            </div>
          )}
        </For>
      </div>
      <SessionNotificationStack
        notifications={notifications()}
        onDismiss={dismissNotification}
        onClick={handleNotifClick}
      />
      <Show when={cmdExpanded() && cmdKind()}>
        <CommandTerminal
          kind={cmdKind()!}
          command={cmdCommand()}
          running={cmdRunning()}
          exitCode={cmdExitCode()}
          outputSubscribe={(cb) => { cmdOutputListeners.push(cb); }}
          onClose={() => {
            setCmdExpanded(false);
            if (!cmdRunning()) {
              setCmdKind(null);
              setCmdLines([]);
              setCmdExitCode(undefined);
            }
          }}
          onKill={handleKillCommand}
        />
      </Show>
    </>
  );
};
