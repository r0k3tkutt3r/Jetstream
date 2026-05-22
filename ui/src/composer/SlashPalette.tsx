import { Component, For, Show, createMemo } from "solid-js";
import fuzzysort from "fuzzysort";
import type { SlashCommand } from "../ipc/types";

export function matchSlash(query: string, all: SlashCommand[]): SlashCommand[] {
  if (!query) return all;
  const results = fuzzysort.go(query, all, { key: "name", limit: 8 });
  return results.map((r) => r.obj);
}

export interface SlashPaletteProps {
  query: string;
  commands: SlashCommand[];
  highlightIndex: number;
  onAccept: (cmd: SlashCommand) => void;
  onHighlight: (i: number) => void;
}

export const SlashPalette: Component<SlashPaletteProps> = (props) => {
  const matches = createMemo(() => matchSlash(props.query, props.commands));

  return (
    <Show when={matches().length > 0}>
      <div style={{
        position: "absolute",
        bottom: "calc(100% + 4px)",
        left: 0,
        right: 0,
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        "border-radius": "6px",
        padding: "4px 0",
        "font-size": "11px",
        "z-index": 10,
        "max-height": "240px",
        "overflow-y": "auto",
      }}>
        <For each={matches()}>
          {(c, i) => (
            <div
              onClick={() => props.onAccept(c)}
              onMouseEnter={() => props.onHighlight(i())}
              style={{
                padding: "4px 12px",
                background: i() === props.highlightIndex ? "var(--accent-bg)" : "transparent",
                color: i() === props.highlightIndex ? "white" : "var(--text-1)",
                cursor: "pointer",
                display: "flex",
                "justify-content": "space-between",
              }}
            >
              <span>
                <b>/{c.name}</b>
                {c.argument_hint && (
                  <span style={{ color: "var(--text-3)" }}> {c.argument_hint}</span>
                )}
              </span>
              <span style={{ color: "var(--text-3)", "margin-left": "12px" }}>{c.description}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};
