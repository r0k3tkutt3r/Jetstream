import { Component, For, Show } from "solid-js";
import type { Message } from "../state/session-store";
import { renderMarkdown } from "./markdown";
import { ToolGroup, AskUserQuestionView } from "./ToolView";

export interface MessageProps {
  message: Message;
  onAnswer?: (text: string) => void;
}

export const MessageRow: Component<MessageProps> = (props) => {
  const regularTools = () =>
    (props.message.tools ?? []).filter(
      (t) => t.name !== "Agent" && t.name !== "Task" && t.name !== "AskUserQuestion",
    );
  const questionTools = () =>
    (props.message.tools ?? []).filter((t) => t.name === "AskUserQuestion");

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
        <Show when={regularTools().length > 0}>
          <ToolGroup tools={regularTools()} />
        </Show>
        <For each={questionTools()}>
          {(t) => <AskUserQuestionView tool={t} onAnswer={props.onAnswer} />}
        </For>
        <Show when={props.message.subagentRefs && props.message.subagentRefs.length > 0}>
          <div style={{ "margin-top": "6px" }}>
            <For each={props.message.subagentRefs}>
              {(ref) => (
                <div style={{
                  background: "var(--bg-0)",
                  "border-left": "2px solid var(--tool-subagent)",
                  padding: "4px 8px",
                  "border-radius": "3px",
                  "font-size": "10px",
                  "margin-top": "2px",
                  display: "flex",
                  "align-items": "baseline",
                  gap: "6px",
                }}>
                  <span style={{ "font-weight": 600 }}>{ref.agent}</span>
                  <Show when={ref.description}>
                    <span style={{ color: "var(--text-2)" }}>{ref.description}</span>
                  </Show>
                  <span style={{ color: "var(--text-3)", "font-size": "9px", "margin-left": "auto" }}>
                    {ref.id.slice(0, 6)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
