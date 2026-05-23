import { Component, Show, createSignal, createEffect, onCleanup } from "solid-js";
import type { CommandKind, CommandStatus } from "../ipc/types";

export interface LiveToastProps {
  kind: CommandKind;
  command: string;
  status: CommandStatus;
  lines: string[];
  exitCode?: number;
  onExpand: () => void;
  onKill: () => void;
  onDismiss: () => void;
}

const KIND_ICON: Record<CommandKind, string> = { run: "▶", test: "✓", build: "⚙" };

export const LiveToast: Component<LiveToastProps> = (props) => {
  const [elapsed, setElapsed] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    if (props.status === "streaming") {
      const start = Date.now();
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    } else if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const isRunning = () => props.status === "streaming";
  const isCompleted = () => props.status === "completed";
  const success = () => props.exitCode === 0;

  const bgColor = () => {
    if (isCompleted()) return success() ? "#0f2a16" : "#2a0f12";
    return "var(--bg-2)";
  };
  const borderColor = () => {
    if (isCompleted()) return success() ? "#166534" : "#7f1d1d";
    return "var(--accent)";
  };
  const textColor = () => {
    if (isCompleted()) return success() ? "#bbf7d0" : "#fecaca";
    return "var(--text-1)";
  };

  return (
    <div
      onClick={() => isRunning() ? props.onExpand() : props.onDismiss()}
      style={{
        background: bgColor(),
        color: textColor(),
        border: `1px solid ${borderColor()}`,
        "border-radius": "6px",
        padding: "10px 12px",
        "font-size": "11px",
        "font-family": "var(--font-mono)",
        cursor: "pointer",
        "max-height": "280px",
        "overflow-y": "auto",
        "min-width": "320px",
        "max-width": "440px",
      }}
      title={isRunning() ? "click to expand terminal" : "click to dismiss"}
    >
      <div style={{
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        "margin-bottom": "6px",
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
          <Show when={isRunning()}>
            <span style={{
              width: "6px",
              height: "6px",
              "border-radius": "50%",
              background: "var(--accent)",
              display: "inline-block",
              animation: "pulse 1.5s infinite",
            }} />
          </Show>
          <span style={{ "font-weight": "bold" }}>
            {KIND_ICON[props.kind]} {props.kind}
          </span>
          <Show when={isRunning()}>
            <span style={{ color: "var(--text-3)", "font-size": "10px" }}>{elapsed()}s</span>
          </Show>
          <Show when={isCompleted()}>
            <span style={{ "font-size": "10px" }}>exit {props.exitCode}</span>
          </Show>
        </div>
        <Show when={isRunning()}>
          <span
            onClick={(e) => { e.stopPropagation(); props.onKill(); }}
            title="kill process"
            style={{
              cursor: "pointer",
              color: "#f87171",
              "font-size": "14px",
              "line-height": "1",
              padding: "0 2px",
            }}
          >&times;</span>
        </Show>
      </div>
      <div style={{
        "font-size": "10px",
        color: "var(--text-3)",
        "margin-bottom": "4px",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
      }}>
        $ {props.command}
      </div>
      <pre style={{
        margin: 0,
        "font-size": "10px",
        "line-height": "1.4",
        "white-space": "pre-wrap",
        "word-break": "break-all",
        color: textColor(),
        opacity: 0.85,
      }}>
        {props.lines.slice(-15).join("\n")}
      </pre>
      <Show when={isRunning()}>
        <div style={{
          "margin-top": "6px",
          "font-size": "9px",
          color: "var(--text-3)",
          "text-align": "center",
        }}>
          click to expand terminal
        </div>
      </Show>
    </div>
  );
};
