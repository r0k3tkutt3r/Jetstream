import { Component, For, Show, createResource, createSignal } from "solid-js";
import { ipc } from "../ipc/bridge";
import type { SessionStore } from "../state/session-store";

export interface RightPaneProps {
  session: SessionStore | null;
}

export const RightPane: Component<RightPaneProps> = (props) => {
  const [caf] = createResource(() => ipc.caffeinateStatus());

  // Re-poll every 2s
  const [, setTick] = createSignal(0);
  setInterval(() => setTick((t) => t + 1), 2000);

  const active = () => Object.values(props.session?.subagents() ?? {}).filter((s) => !s.completed);
  const done   = () => Object.values(props.session?.subagents() ?? {}).filter((s) =>  s.completed).slice(-5);

  return (
    <div class="pane">
      <div class="pane-header">
        <div style={{ "font-size": "11px", color: "var(--text-2)" }}>Subagents</div>
        <div style={{ "font-size": "9px", color: "var(--text-3)" }}>{active().length} active</div>
      </div>
      <div class="pane-body">
        <Show when={props.session} fallback={<div style={{ color: "var(--text-3)" }}>—</div>}>
          <For each={active()}>
            {(s) => (
              <div style={{
                background: "var(--accent-bg)",
                "border-left": "2px solid var(--accent)",
                padding: "8px",
                "border-radius": "4px",
                "margin-bottom": "6px",
              }}>
                <div style={{ "font-size": "10px", "font-weight": 600 }}>{s.agent}</div>
                <div style={{ "font-size": "9px", color: "var(--text-2)" }}>{s.prompt}</div>
              </div>
            )}
          </For>
          <For each={done()}>
            {(s) => (
              <div style={{
                padding: "4px 8px",
                "border-radius": "3px",
                color: "var(--text-3)",
                "font-size": "10px",
                opacity: 0.8,
              }}>{s.agent} · done</div>
            )}
          </For>
        </Show>
      </div>
      <div style={{
        "border-top": "1px solid var(--border)",
        padding: "6px 10px",
        display: "flex",
        "justify-content": "space-between",
        "font-size": "9px",
        color: "var(--text-3)",
      }}>
        <span>☕ {caf()?.active ? `holding ${caf()?.refcount}` : "off"}</span>
        <span>${props.session?.cost().toFixed(3) ?? "0.000"}</span>
      </div>
    </div>
  );
};
