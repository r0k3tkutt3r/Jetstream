import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { ipc } from "../ipc/bridge";
import type { SessionStore } from "../state/session-store";

export interface RightPaneProps {
  session: SessionStore | null;
}

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

export const RightPane: Component<RightPaneProps> = (props) => {
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 2000);
  onCleanup(() => clearInterval(tickInterval));

  const [caf] = createResource(tick, () => ipc.caffeinateStatus());

  const active = () => Object.values(props.session?.subagents() ?? {}).filter((s) => !s.completed);
  const done   = () => Object.values(props.session?.subagents() ?? {}).filter((s) =>  s.completed).slice(-5);

  const ctxPct = () => {
    const tokens = props.session?.cumulativeTokens() ?? 0;
    return Math.min(100, (tokens / DEFAULT_CONTEXT_WINDOW) * 100);
  };

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
      <Show when={props.session}>
        <div style={{
          "border-top": "1px solid var(--border)",
          padding: "8px 10px",
          display: "flex",
          "flex-direction": "column",
          gap: "6px",
        }}>
          <div class="section-label" style={{ "margin-bottom": 0 }}>Context</div>
          <div style={{ "font-size": "10px", color: "var(--text-2)", display: "flex", "justify-content": "space-between" }}>
            <span>{fmtTokens(props.session!.cumulativeTokens())} / {fmtTokens(DEFAULT_CONTEXT_WINDOW)}</span>
            <span>{ctxPct().toFixed(1)}%</span>
          </div>
          <div style={{
            height: "4px",
            background: "var(--bg-0)",
            "border-radius": "2px",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${ctxPct()}%`,
              height: "100%",
              background: ctxPct() > 80 ? "var(--mode-bypass)" : "var(--accent)",
              transition: "width 0.3s",
            }} />
          </div>
          <Show when={props.session!.usage()}>
            <div style={{ "font-size": "9px", color: "var(--text-3)", "line-height": "1.4" }}>
              <div>in: {fmtTokens(props.session!.usage()!.input_tokens)} · out: {fmtTokens(props.session!.usage()!.output_tokens)}</div>
              <div>cache r: {fmtTokens(props.session!.usage()!.cache_read_input_tokens)} · w: {fmtTokens(props.session!.usage()!.cache_creation_input_tokens)}</div>
            </div>
          </Show>
        </div>
      </Show>
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
