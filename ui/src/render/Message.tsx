import { Component, For, Show } from "solid-js";
import type { Message } from "../state/session-store";
import { renderMarkdown } from "./markdown";

export interface MessageProps {
  message: Message;
}

export const MessageRow: Component<MessageProps> = (props) => {
  return (
    <div style={{ "margin-bottom": "12px" }}>
      <div class="section-label">{props.message.role}</div>
      <div
        style={{
          background: props.message.role === "user" ? "var(--bg-3)" : "var(--bg-2)",
          padding: "10px 12px",
          "border-radius": "6px",
        }}
      >
        <div innerHTML={renderMarkdown(props.message)} />
        <Show when={props.message.tools && props.message.tools.length > 0}>
          <For each={props.message.tools}>
            {(t) => (
              <div style={{
                "margin-top": "6px",
                background: "var(--bg-0)",
                "border-left": `2px solid ${toolColor(t.name)}`,
                padding: "5px 8px",
                "border-radius": "3px",
                "font-size": "11px",
              }}>
                ⚙ <b>{t.name}</b> <span style={{ color: "var(--text-3)" }}>{JSON.stringify(t.input).slice(0, 80)}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};

function toolColor(name: string): string {
  if (name === "Read")   return "var(--tool-read)";
  if (name === "Edit" || name === "Write") return "var(--tool-edit)";
  if (name === "Bash")   return "var(--tool-bash)";
  if (name === "Agent" || name === "Task") return "var(--tool-subagent)";
  return "var(--text-3)";
}
