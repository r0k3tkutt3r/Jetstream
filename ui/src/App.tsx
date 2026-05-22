import { Component, createEffect, createSignal, onCleanup } from "solid-js";
import { Layout } from "./panes/Layout";
import { ipc, subscribeSession } from "./ipc/bridge";
import { createSessionStore, type SessionStore } from "./state/session-store";
import type { SessionSummary } from "./ipc/types";

export const App: Component = () => {
  const [sessions, setSessions] = createSignal<SessionSummary[]>([]);
  const [stores, setStores] = createSignal<Record<string, SessionStore>>({});
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [showLeft, setShowLeft] = createSignal(true);
  const [showRight, setShowRight] = createSignal(true);

  const refresh = async () => setSessions(await ipc.listSessions());

  const newSession = async () => {
    const s = await ipc.spawnSession({ cwd: ".", name: `session-${sessions().length + 1}` });
    const store = createSessionStore(s);
    const un = await subscribeSession(s.id, store.handleEvent);
    onCleanup(un);
    setStores({ ...stores(), [s.id]: store });
    setActiveId(s.id);
    await refresh();
  };

  const send = async (text: string) => {
    const id = activeId();
    if (!id) return;
    stores()[id]?.appendUserMessage(text);
    await ipc.sendUserMessage(id, text);
  };

  const cycle = async () => {
    const id = activeId();
    if (!id) return;
    const next = await ipc.cycleMode(id);
    stores()[id]?.setMode(next);
  };

  // Keyboard: ⇧⇥ cycle, ⌘B toggle left, ⌘J toggle right, ⌘N new
  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Tab") { e.preventDefault(); void cycle(); return; }
      if (e.metaKey && e.key === "b")   { e.preventDefault(); setShowLeft(!showLeft());  return; }
      if (e.metaKey && e.key === "j")   { e.preventDefault(); setShowRight(!showRight()); return; }
      if (e.metaKey && e.key === "n")   { e.preventDefault(); void newSession();         return; }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  return (
    <Layout
      showLeft={showLeft()}
      showRight={showRight()}
      left={{
        sessions: sessions(),
        activeId: activeId(),
        onSelectSession: setActiveId,
        onNewSession: () => void newSession(),
        onSelectAgent: () => {},
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
  );
};
