import { Component, Show, onMount, onCleanup, createSignal } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "../ipc/bridge";
import type { CommandKind } from "../ipc/types";

export interface CommandTerminalProps {
  kind: CommandKind;
  command: string;
  running: boolean;
  exitCode?: number;
  outputSubscribe: (cb: (data: number[]) => void) => void;
  onClose: () => void;
  onKill: () => void;
}

export const CommandTerminal: Component<CommandTerminalProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let term: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const [elapsed, setElapsed] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    if (!containerRef) return;

    term = new Terminal({
      theme: {
        background: "#0b0b0d",
        foreground: "#ececec",
        cursor: "#60a5fa",
        selectionBackground: "#1e3a8a88",
      },
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef);

    requestAnimationFrame(() => {
      fitAddon!.fit();
      const dims = fitAddon!.proposeDimensions();
      if (dims) {
        ipc.resizeCommand(dims.cols, dims.rows).catch(() => {});
      }
    });

    // Load existing buffer
    try {
      const buf = await ipc.getCommandBuffer();
      if (buf.length > 0) {
        term.write(new Uint8Array(buf));
      }
    } catch {
      // Runner may have already exited
    }

    // Forward keyboard input to the PTY
    term.onData((data: string) => {
      ipc.sendCommandInput(data).catch(() => {});
    });

    // Subscribe to live output
    props.outputSubscribe((data: number[]) => {
      term?.write(new Uint8Array(data));
    });

    // Handle resize
    resizeObserver = new ResizeObserver(() => {
      fitAddon!.fit();
      const dims = fitAddon!.proposeDimensions();
      if (dims) {
        ipc.resizeCommand(dims.cols, dims.rows).catch(() => {});
      }
    });
    resizeObserver.observe(containerRef);

    // Elapsed timer
    if (props.running) {
      const start = Date.now();
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    }
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    term?.dispose();
    if (timer) clearInterval(timer);
  });

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      height: "40vh",
      "min-height": "200px",
      "max-height": "500px",
      background: "var(--bg-0)",
      "border-top": "2px solid var(--accent)",
      display: "flex",
      "flex-direction": "column",
      "z-index": 10000,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        padding: "6px 12px",
        background: "var(--bg-1)",
        "border-bottom": "1px solid var(--border)",
        "font-size": "11px",
        "font-family": "var(--font-mono)",
        "flex-shrink": 0,
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{ color: "var(--text-2)" }}>$ {props.command}</span>
          <Show when={props.running}>
            <span style={{ color: "var(--text-3)", "font-size": "10px" }}>{elapsed()}s</span>
          </Show>
          <Show when={!props.running && props.exitCode !== undefined}>
            <span style={{
              color: props.exitCode === 0 ? "#22c55e" : "#f87171",
              "font-size": "10px",
            }}>
              exit {props.exitCode}
            </span>
          </Show>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Show when={props.running}>
            <button
              onClick={props.onKill}
              style={{
                background: "transparent",
                border: "1px solid #7f1d1d",
                color: "#f87171",
                "border-radius": "3px",
                padding: "2px 8px",
                cursor: "pointer",
                "font-size": "10px",
                "font-family": "inherit",
              }}
            >
              Kill
            </button>
          </Show>
          <button
            onClick={props.onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
              "border-radius": "3px",
              padding: "2px 8px",
              cursor: "pointer",
              "font-size": "10px",
              "font-family": "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
      {/* Terminal area */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: "4px",
          overflow: "hidden",
        }}
      />
    </div>
  );
};
