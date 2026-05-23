import { Component, For, Show } from "solid-js";
import type { Todo } from "../state/session-store";

export interface TodoPanelProps {
  todos: Todo[];
}

function statusIcon(status: Todo["status"]): string {
  if (status === "completed") return "☑";
  if (status === "in_progress") return "▶";
  return "☐";
}

function statusColor(status: Todo["status"]): string {
  if (status === "completed") return "var(--text-3)";
  if (status === "in_progress") return "var(--accent)";
  return "var(--text-1)";
}

export const TodoPanel: Component<TodoPanelProps> = (props) => {
  const total = () => props.todos.length;
  const done = () => props.todos.filter((t) => t.status === "completed").length;
  return (
    <Show when={total() > 0}>
      <div style={{
        "border-top": "1px solid var(--border)",
        "border-bottom": "1px solid var(--border)",
        background: "var(--bg-1)",
        "max-height": "min(35vh, 280px)",
        display: "flex",
        "flex-direction": "column",
        "min-height": 0,
      }}>
        <div style={{
          padding: "6px 12px",
          "font-size": "10px",
          "text-transform": "uppercase",
          "letter-spacing": "0.06em",
          color: "var(--text-3)",
          display: "flex",
          "justify-content": "space-between",
        }}>
          <span>Todos</span>
          <span>{done()}/{total()}</span>
        </div>
        <div style={{ "overflow-y": "auto", padding: "4px 12px 8px", "min-height": 0 }}>
          <For each={props.todos}>
            {(todo) => (
              <div style={{
                display: "flex",
                gap: "8px",
                "align-items": "flex-start",
                padding: "3px 0",
                "font-size": "12px",
              }}>
                <span style={{
                  color: statusColor(todo.status),
                  "font-size": "13px",
                  "line-height": "1.2",
                  "min-width": "14px",
                  "padding-top": "1px",
                }}>{statusIcon(todo.status)}</span>
                <div style={{ "flex": 1, "min-width": 0 }}>
                  <div style={{
                    color: statusColor(todo.status),
                    "text-decoration": todo.status === "completed" ? "line-through" : "none",
                    "font-weight": todo.status === "in_progress" ? 600 : 400,
                    "line-height": "1.3",
                  }}>{todo.subject}</div>
                  <Show when={todo.description}>
                    <div style={{
                      "font-size": "10px",
                      color: "var(--text-3)",
                      "line-height": "1.3",
                      "margin-top": "1px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }} title={todo.description}>{todo.description}</div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
};
