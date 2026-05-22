import { Component, For, Show, createResource, createSignal } from "solid-js";
import { ipc } from "../ipc/bridge";
import type { Agent, SessionSummary } from "../ipc/types";

export interface LeftPaneProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSelectAgent: (a: Agent) => void;
}

export const LeftPane: Component<LeftPaneProps> = (props) => {
  const [agents] = createResource(() => ipc.listAgents());
  const [filter, setFilter] = createSignal("");

  const filteredAgents = () => {
    const q = filter().toLowerCase();
    const all = agents() ?? [];
    return q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all;
  };

  return (
    <div class="pane">
      <div class="pane-header">
        <div style={{ "font-size": "11px", color: "var(--text-2)" }}>Workspace</div>
        <div style={{ cursor: "pointer", "font-size": "14px" }} onClick={props.onNewSession}>＋</div>
      </div>
      <div class="pane-body" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div>
          <div class="section-label">Sessions</div>
          <For each={props.sessions} fallback={<div style={{ color: "var(--text-3)", "font-size": "11px" }}>no sessions yet</div>}>
            {(s) => (
              <div
                onClick={() => props.onSelectSession(s.id)}
                style={{
                  padding: "6px 8px",
                  "border-radius": "3px",
                  cursor: "pointer",
                  "margin-bottom": "4px",
                  background: props.activeId === s.id ? "var(--accent-bg)" : "transparent",
                  "border-left": props.activeId === s.id ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div style={{ "font-size": "11px" }}>{s.name || "(unnamed)"}</div>
                <div style={{ "font-size": "9px", color: "var(--text-3)" }}>{s.mode}</div>
              </div>
            )}
          </For>
        </div>

        <div style={{ "border-top": "1px solid var(--border)", "padding-top": "10px" }}>
          <div class="section-label" style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
            <span>Agents</span>
            <input
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              placeholder="filter…"
              style={{ "font-size": "10px", padding: "2px 6px", width: "80px", background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--border)", "border-radius": "3px" }}
            />
          </div>
          <Show when={agents()}>
            <For each={filteredAgents()}>
              {(a) => (
                <div
                  onClick={() => props.onSelectAgent(a)}
                  style={{ padding: "4px 8px", "border-radius": "3px", cursor: "pointer" }}
                  title={a.description}
                >
                  <div style={{ "font-size": "11px" }}>{a.name}</div>
                  <div style={{ "font-size": "9px", color: "var(--text-3)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                    {a.description}
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};
