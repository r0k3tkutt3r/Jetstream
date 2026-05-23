import { Component, Show, type JSX } from "solid-js";
import type { ToolCall } from "../state/session-store";

export interface ToolBlockProps {
  tool: ToolCall;
}

const COLOR: Record<string, string> = {
  Read: "var(--tool-read)",
  Edit: "var(--tool-edit)",
  MultiEdit: "var(--tool-edit)",
  Write: "var(--tool-edit)",
  Bash: "var(--tool-bash)",
  Glob: "var(--tool-read)",
  Grep: "var(--tool-read)",
  WebFetch: "var(--tool-read)",
  WebSearch: "var(--tool-read)",
  Task: "var(--tool-subagent)",
  Agent: "var(--tool-subagent)",
  TodoWrite: "var(--tool-subagent)",
};

const ICON: Record<string, string> = {
  Read: "📖",
  Edit: "✏️",
  MultiEdit: "✏️",
  Write: "📝",
  Bash: "$",
  Glob: "🔍",
  Grep: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Task: "🤖",
  Agent: "🤖",
  TodoWrite: "✓",
};

function clamp(s: string | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function asObj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

function asStr(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

function asNum(x: unknown): number | undefined {
  return typeof x === "number" ? x : undefined;
}

function renderBody(name: string, input: unknown): JSX.Element {
  const o = asObj(input);
  switch (name) {
    case "Read": {
      const fp = asStr(o.file_path) ?? "(no path)";
      const offset = asNum(o.offset);
      const limit = asNum(o.limit);
      const range = offset !== undefined ? ` (lines ${offset}${limit ? `–${offset + limit}` : "+"})` : "";
      return <span><b>Read</b> · {fp}{range}</span>;
    }
    case "Write": {
      const fp = asStr(o.file_path) ?? "(no path)";
      const content = asStr(o.content) ?? "";
      const lines = content ? content.split("\n").length : 0;
      return <span><b>Write</b> · {fp} <span style={{ color: "var(--text-3)" }}>({lines} lines)</span></span>;
    }
    case "Edit": {
      const fp = asStr(o.file_path) ?? "(no path)";
      const oldS = asStr(o.old_string);
      const newS = asStr(o.new_string);
      return (
        <div>
          <div><b>Edit</b> · {fp}</div>
          <Show when={oldS !== undefined || newS !== undefined}>
            <div style={{ "font-size": "10px", color: "var(--text-3)", "margin-top": "2px", "font-family": "monospace" }}>
              <div>- {clamp(oldS?.split("\n")[0], 70)}</div>
              <div>+ {clamp(newS?.split("\n")[0], 70)}</div>
            </div>
          </Show>
        </div>
      );
    }
    case "MultiEdit": {
      const fp = asStr(o.file_path) ?? "(no path)";
      const edits = Array.isArray(o.edits) ? o.edits.length : 0;
      return <span><b>Edit</b> · {fp} <span style={{ color: "var(--text-3)" }}>({edits} edits)</span></span>;
    }
    case "Bash": {
      const cmd = asStr(o.command) ?? "";
      const desc = asStr(o.description);
      return (
        <div>
          <div style={{ "font-family": "monospace", "white-space": "pre-wrap", "line-height": "1.35", "max-height": "4.2em", overflow: "hidden" }}>
            <span style={{ color: "var(--text-3)" }}>$ </span>{cmd}
          </div>
          <Show when={desc}>
            <div style={{ color: "var(--text-3)", "margin-top": "2px", "font-size": "10px" }}>{desc}</div>
          </Show>
        </div>
      );
    }
    case "Glob": {
      const pat = asStr(o.pattern) ?? "";
      const path = asStr(o.path);
      return <span><b>Glob</b> · {pat}{path ? ` in ${path}` : ""}</span>;
    }
    case "Grep": {
      const pat = asStr(o.pattern) ?? "";
      const path = asStr(o.path);
      return <span><b>Grep</b> · {pat}{path ? ` in ${path}` : ""}</span>;
    }
    case "WebFetch": {
      const url = asStr(o.url) ?? "";
      const prompt = asStr(o.prompt);
      return (
        <div>
          <div><b>Fetch</b> · {url}</div>
          <Show when={prompt}>
            <div style={{ color: "var(--text-3)", "margin-top": "2px", "font-size": "10px" }}>{clamp(prompt, 120)}</div>
          </Show>
        </div>
      );
    }
    case "WebSearch": {
      const q = asStr(o.query) ?? "";
      return <span><b>Search</b> · {q}</span>;
    }
    case "Task":
    case "Agent": {
      const sub = asStr(o.subagent_type) ?? "agent";
      const desc = asStr(o.description) ?? asStr(o.prompt) ?? "";
      return <span><b>{sub}</b>: <span style={{ color: "var(--text-3)" }}>{clamp(desc, 120)}</span></span>;
    }
    case "TodoWrite": {
      const todos = Array.isArray(o.todos) ? o.todos : [];
      const completed = todos.filter((t: any) => t?.status === "completed").length;
      return <span><b>Todos</b> · {completed}/{todos.length} <span style={{ color: "var(--text-3)" }}>(see pinned panel)</span></span>;
    }
    default: {
      const dump = (() => { try { return JSON.stringify(input); } catch { return ""; } })();
      return <span><b>{name}</b> <span style={{ color: "var(--text-3)" }}>{clamp(dump, 80)}</span></span>;
    }
  }
}

export const ToolBlock: Component<ToolBlockProps> = (props) => {
  const color = () => COLOR[props.tool.name] ?? "var(--text-3)";
  const icon = () => ICON[props.tool.name] ?? "⚙";
  return (
    <div style={{
      "margin-top": "6px",
      background: "var(--bg-0)",
      "border-left": `2px solid ${color()}`,
      padding: "5px 8px",
      "border-radius": "3px",
      "font-size": "11px",
    }}>
      <span style={{ "margin-right": "6px" }}>{icon()}</span>
      {renderBody(props.tool.name, props.tool.input)}
    </div>
  );
};
