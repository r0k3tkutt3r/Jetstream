import { Component, For, createEffect, createSignal, onCleanup } from "solid-js";
import { Layout } from "./panes/Layout";
import { Settings } from "./settings/Settings";
import { ipc, subscribeSession } from "./ipc/bridge";
import { createSessionStore, type SessionStore } from "./state/session-store";
import type { SessionSummary } from "./ipc/types";

interface Toast {
  id: number;
  kind: "success" | "error";
  title: string;
  body: string;
}

export const App: Component = () => {
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
  let toastCounter = 0;

  const pushToast = (kind: "success" | "error", title: string, body: string) => {
    const id = ++toastCounter;
    setToasts((cur) => [...cur, { id, kind, title, body }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 8000);
  };
  const dismissToast = (id: number) =>
    setToasts((cur) => cur.filter((t) => t.id !== id));

  // Restore last cwd, falling back to home dir.
  void (async () => {
    const last = await ipc.getLastCwd().catch(() => null);
    if (last && !currentCwd()) {
      setCurrentCwd(last);
      return;
    }
    if (!currentCwd()) {
      const home = await ipc.getDefaultCwd().catch(() => "");
      if (home && !currentCwd()) setCurrentCwd(home);
    }
  })();

  // Persist cwd when it changes (skip the empty initial value).
  createEffect(() => {
    const cwd = currentCwd();
    if (cwd) void ipc.setLastCwd(cwd).catch(() => {});
  });

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
    const un = await subscribeSession(s.id, store.handleEvent);
    onCleanup(un);
    setStores({ ...stores(), [s.id]: store });
    return store;
  };

  const newSession = async () => {
    try {
      const s = await ipc.spawnSession({ cwd: currentCwd(), name: `session-${Object.keys(stores()).length + 1}` });
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
    if (stores()[s.id]) {
      setActiveId(s.id);
      return;
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

    if (text.trim() === "/clear") {
      store.reset();
      return;
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
          onSetCwd: setCurrentCwd,
          onActivateSession: (s) => void activateSession(s),
          onNewSession: () => void newSession(),
          onPickCwd: () => void pickCwd(),
          onShowToast: pushToast,
        }}
        center={{
          session: activeId() ? stores()[activeId()!] ?? null : null,
          onSend: (t) => void send(t),
          onCycleMode: () => void cycle(),
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
    </>
  );
};
