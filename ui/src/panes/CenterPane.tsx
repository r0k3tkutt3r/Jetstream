import { Component, For, Show, createSignal } from "solid-js";
import type { SessionStore } from "../state/session-store";

export interface CenterPaneProps {
  session: SessionStore | null;
  onSend: (text: string) => void;
  onCycleMode: () => void;
}

export const CenterPane: Component<CenterPaneProps> = (props) => {
  const [input, setInput] = createSignal("");

  const submit = () => {
    const t = input().trim();
    if (!t) return;
    props.onSend(t);
    setInput("");
  };

  return (
    <div class="pane">
      <Show when={props.session} fallback={
        <div style={{ flex: 1, display: "grid", "place-items": "center", color: "var(--text-3)" }}>
          Pick or start a session
        </div>
      }>
        <div class="pane-header">
          <div>
            <div style={{ "font-size": "12px" }}>{props.session!.name}</div>
            <div style={{ "font-size": "9px", color: "var(--text-3)" }}>
              {props.session!.cwd} · {props.session!.id.slice(0, 8)}…
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
            <span
              onClick={props.onCycleMode}
              style={{
                background: modeColor(props.session!.mode()),
                color: "white",
                "font-size": "9px",
                padding: "2px 8px",
                "border-radius": "10px",
                cursor: "pointer",
              }}
            >{props.session!.mode()}</span>
            <span style={{ color: "var(--text-3)", "font-size": "10px" }}>⇧⇥ to cycle</span>
          </div>
        </div>

        <div class="pane-body">
          <For each={props.session!.messages()}>
            {(m) => (
              <div style={{ "margin-bottom": "10px" }}>
                <div class="section-label">{m.role}</div>
                <div style={{
                  background: m.role === "user" ? "var(--bg-3)" : "var(--bg-2)",
                  padding: "8px 10px",
                  "border-radius": "6px",
                  "white-space": "pre-wrap",
                }}>{m.content}</div>
              </div>
            )}
          </For>
        </div>

        <div style={{ "border-top": "1px solid var(--border)", padding: "8px 12px" }}>
          <textarea
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="› message (Enter to send, Shift+Enter for newline)"
            rows={2}
            style={{
              width: "100%",
              background: "var(--bg-0)",
              color: "var(--text-1)",
              border: "1px solid var(--border)",
              "border-radius": "6px",
              padding: "8px 10px",
              "font-family": "inherit",
              "font-size": "12px",
              resize: "none",
            }}
          />
        </div>
      </Show>
    </div>
  );
};

function modeColor(mode: string): string {
  switch (mode) {
    case "bypassPermissions": return "var(--mode-bypass)";
    case "plan":              return "var(--mode-plan)";
    case "acceptEdits":       return "var(--mode-accept)";
    default:                  return "var(--mode-default)";
  }
}
