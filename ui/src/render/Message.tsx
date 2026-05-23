import { Component, For, Show } from "solid-js";
import type { Message } from "../state/session-store";
import { renderMarkdown } from "./markdown";
import { ToolBlock } from "./ToolView";

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
            {(t) => <ToolBlock tool={t} />}
          </For>
        </Show>
        <Show when={props.message.subagentRefs && props.message.subagentRefs.length > 0}>
          <div style={{ "margin-top": "6px" }}>
            <For each={props.message.subagentRefs}>
              {(id) => (
                <div style={{
                  background: "var(--bg-0)",
                  "border-left": "2px solid var(--tool-subagent)",
                  padding: "5px 8px",
                  "border-radius": "3px",
                  "font-size": "11px",
                  "margin-top": "3px",
                }}>
                  🤖 <b>Agent</b> <span style={{ color: "var(--text-3)" }}>(see right pane · id {id.slice(0, 6)}…)</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
