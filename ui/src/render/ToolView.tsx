import { Component, For, Show, createSignal, type JSX } from "solid-js";
import type { ToolCall } from "../state/session-store";

/* ── AskUserQuestion interactive view ─────────────────────────── */

interface QOption {
  label: string;
  description?: string;
}

interface QData {
  question: string;
  header: string;
  options: QOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionViewProps {
  tool: ToolCall;
  onAnswer?: (text: string) => void;
}

export const AskUserQuestionView: Component<AskUserQuestionViewProps> = (props) => {
  const questions = (): QData[] => {
    const input = asObj(props.tool.input);
    return Array.isArray(input.questions) ? input.questions as QData[] : [];
  };

  const [submitted, setSubmitted] = createSignal(false);
  const isAnswered = () => !!props.tool.output || submitted();

  const [selections, setSelections] = createSignal<Record<number, string[]>>({});
  const [customTexts, setCustomTexts] = createSignal<Record<number, string>>({});
  const [otherActive, setOtherActive] = createSignal<Record<number, boolean>>({});

  const isSelected = (qi: number, label: string) =>
    (selections()[qi] ?? []).includes(label);

  const toggleOption = (qi: number, label: string, multi: boolean) => {
    setOtherActive((prev) => ({ ...prev, [qi]: false }));
    setSelections((prev) => {
      const cur = [...(prev[qi] ?? [])];
      const idx = cur.indexOf(label);
      if (multi) {
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(label);
        return { ...prev, [qi]: cur };
      }
      return { ...prev, [qi]: idx >= 0 ? [] : [label] };
    });
  };

  const activateOther = (qi: number, multi: boolean) => {
    setOtherActive((prev) => ({ ...prev, [qi]: true }));
    if (!multi) setSelections((prev) => ({ ...prev, [qi]: [] }));
  };

  const hasAnswer = () => {
    const qs = questions();
    for (let i = 0; i < qs.length; i++) {
      if ((selections()[i] ?? []).length > 0) return true;
      if (otherActive()[i] && (customTexts()[i]?.trim() ?? "")) return true;
    }
    return false;
  };

  const handleSubmit = () => {
    const qs = questions();
    const parts: string[] = [];
    for (let i = 0; i < qs.length; i++) {
      const sel = selections()[i] ?? [];
      const custom = customTexts()[i]?.trim() ?? "";
      const isOther = otherActive()[i];
      const answer = isOther && custom ? custom : sel.length > 0 ? sel.join(", ") : "";
      if (answer) parts.push(qs.length > 1 ? `${qs[i].header}: ${answer}` : answer);
    }
    if (parts.length > 0) {
      setSubmitted(true);
      props.onAnswer?.(parts.join("\n"));
    }
  };

  const handleDeny = () => {
    setSubmitted(true);
    props.onAnswer?.("I'd rather not answer this question.");
  };

  const radioStyle = (selected: boolean, multi: boolean): JSX.CSSProperties => ({
    width: "14px",
    height: "14px",
    "border-radius": multi ? "3px" : "50%",
    border: `2px solid ${selected ? "var(--accent)" : "var(--text-3)"}`,
    background: selected ? "var(--accent)" : "transparent",
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    "flex-shrink": "0",
    "font-size": "9px",
    color: "white",
  });

  const cardStyle = (selected: boolean): JSX.CSSProperties => ({
    background: selected ? "color-mix(in srgb, var(--accent) 12%, var(--bg-2))" : "var(--bg-2)",
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    "border-radius": "6px",
    padding: "8px 12px",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  });

  return (
    <div style={{
      "margin-top": "8px",
      background: "var(--bg-1)",
      border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
      "border-radius": "8px",
      padding: "12px",
      "font-size": "12px",
    }}>
      <Show when={!isAnswered()} fallback={
        <div style={{ display: "flex", "align-items": "center", gap: "6px", color: "var(--text-2)", "font-size": "11px" }}>
          <span style={{ color: "var(--accent)" }}>✓</span>
          <span>Answered</span>
          <Show when={props.tool.output}>
            <span style={{ color: "var(--text-3)" }}>
              — {typeof props.tool.output === "string"
                ? clamp(props.tool.output as string, 80)
                : "response sent"}
            </span>
          </Show>
        </div>
      }>
        <For each={questions()}>
          {(q, qi) => (
            <div style={{ "margin-bottom": qi() < questions().length - 1 ? "16px" : "0" }}>
              <div style={{ "margin-bottom": "6px" }}>
                <span style={{
                  background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                  color: "var(--accent)",
                  "font-size": "10px",
                  "font-weight": "600",
                  padding: "2px 8px",
                  "border-radius": "10px",
                }}>
                  {q.header}
                  {q.multiSelect ? " (select multiple)" : ""}
                </span>
              </div>

              <div style={{ "margin-bottom": "8px", color: "var(--text-1)" }}>
                {q.question}
              </div>

              <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                <For each={q.options}>
                  {(opt) => {
                    const sel = () => isSelected(qi(), opt.label);
                    return (
                      <div onClick={() => toggleOption(qi(), opt.label, q.multiSelect)} style={cardStyle(sel())}>
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <span style={radioStyle(sel(), q.multiSelect)}>
                            <Show when={sel()}>✓</Show>
                          </span>
                          <span style={{ "font-weight": "500", color: "var(--text-1)" }}>{opt.label}</span>
                        </div>
                        <Show when={opt.description}>
                          <div style={{ "margin-top": "3px", "padding-left": "22px", color: "var(--text-3)", "font-size": "11px" }}>
                            {opt.description}
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>

                {/* "Other" — custom text option */}
                <div onClick={() => activateOther(qi(), q.multiSelect)} style={cardStyle(!!otherActive()[qi()])}>
                  <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                    <span style={radioStyle(!!otherActive()[qi()], q.multiSelect)}>
                      <Show when={otherActive()[qi()]}>✓</Show>
                    </span>
                    <span style={{ "font-weight": "500", color: "var(--text-1)" }}>Other</span>
                    <span style={{ color: "var(--text-3)", "font-size": "10px" }}>type your answer</span>
                  </div>
                  <Show when={otherActive()[qi()]}>
                    <div style={{ "margin-top": "6px", "padding-left": "22px" }}>
                      <textarea
                        value={customTexts()[qi()] ?? ""}
                        onInput={(e) => setCustomTexts((prev) => ({ ...prev, [qi()]: e.currentTarget.value }))}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                        }}
                        placeholder="Type your answer..."
                        rows={2}
                        style={{
                          width: "100%",
                          background: "var(--bg-0)",
                          color: "var(--text-1)",
                          border: "1px solid var(--border)",
                          "border-radius": "4px",
                          padding: "6px 8px",
                          "font-family": "inherit",
                          "font-size": "11px",
                          resize: "vertical",
                          "box-sizing": "border-box",
                        }}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>

        {/* Action bar */}
        <div style={{
          display: "flex",
          gap: "8px",
          "justify-content": "flex-end",
          "margin-top": "10px",
          "padding-top": "8px",
          "border-top": "1px solid var(--border)",
        }}>
          <button
            onClick={handleDeny}
            style={{
              background: "transparent",
              color: "var(--text-3)",
              border: "1px solid var(--border)",
              "border-radius": "4px",
              padding: "5px 14px",
              "font-size": "11px",
              cursor: "pointer",
              "font-family": "inherit",
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasAnswer()}
            style={{
              background: hasAnswer() ? "var(--accent)" : "var(--bg-3)",
              color: hasAnswer() ? "white" : "var(--text-3)",
              border: "none",
              "border-radius": "4px",
              padding: "5px 18px",
              "font-size": "11px",
              "font-weight": "600",
              cursor: hasAnswer() ? "pointer" : "default",
              "font-family": "inherit",
              opacity: hasAnswer() ? "1" : "0.6",
            }}
          >
            Submit
          </button>
        </div>
      </Show>
    </div>
  );
};

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
  AskUserQuestion: "var(--accent)",
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
  AskUserQuestion: "❓",
};

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

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

function renderCompact(name: string, input: unknown): JSX.Element {
  const o = asObj(input);
  switch (name) {
    case "Read": {
      const fp = basename(asStr(o.file_path) ?? "?");
      const offset = asNum(o.offset);
      const limit = asNum(o.limit);
      const range = offset !== undefined ? ` (lines ${offset}${limit ? `–${offset + limit}` : "+"})` : "";
      return <><b>Read</b> · {fp}{range}</>;
    }
    case "Write": {
      const fp = basename(asStr(o.file_path) ?? "?");
      const content = asStr(o.content) ?? "";
      const lines = content ? content.split("\n").length : 0;
      return <><b>Write</b> · {fp} <span style={{ color: "var(--text-3)" }}>({lines}L)</span></>;
    }
    case "Edit": {
      const fp = basename(asStr(o.file_path) ?? "?");
      return <><b>Edit</b> · {fp}</>;
    }
    case "MultiEdit": {
      const fp = basename(asStr(o.file_path) ?? "?");
      const edits = Array.isArray(o.edits) ? o.edits.length : 0;
      return <><b>Edit</b> · {fp} <span style={{ color: "var(--text-3)" }}>({edits}×)</span></>;
    }
    case "Bash": {
      const cmd = clamp(asStr(o.command) ?? "", 70);
      return <><span style={{ color: "var(--text-3)" }}>$ </span>{cmd}</>;
    }
    case "Glob": {
      const pat = asStr(o.pattern) ?? "";
      return <><b>Glob</b> · {clamp(pat, 50)}</>;
    }
    case "Grep": {
      const pat = asStr(o.pattern) ?? "";
      return <><b>Grep</b> · {clamp(pat, 50)}</>;
    }
    case "WebFetch": {
      const url = asStr(o.url) ?? "";
      return <><b>Fetch</b> · {clamp(url, 60)}</>;
    }
    case "WebSearch": {
      const q = asStr(o.query) ?? "";
      return <><b>Search</b> · {clamp(q, 60)}</>;
    }
    case "Task":
    case "Agent": {
      const sub = asStr(o.subagent_type) ?? "agent";
      const desc = asStr(o.description) ?? asStr(o.prompt) ?? "";
      return <><b>{sub}</b>: <span style={{ color: "var(--text-3)" }}>{clamp(desc, 80)}</span></>;
    }
    case "TodoWrite": {
      const todos = Array.isArray(o.todos) ? o.todos : [];
      const completed = todos.filter((t: any) => t?.status === "completed").length;
      return <><b>Todos</b> · {completed}/{todos.length}</>;
    }
    case "AskUserQuestion": {
      const qs = Array.isArray(o.questions) ? o.questions : [];
      return <><b>Question</b> · {qs.length} question{qs.length !== 1 ? "s" : ""}</>;
    }
    default: {
      return <><b>{name}</b></>;
    }
  }
}

function toolSummary(tools: ToolCall[]): string {
  const counts: Record<string, number> = {};
  for (const t of tools) {
    const label = t.name === "MultiEdit" ? "Edit" : t.name;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts).map(([n, c]) => c > 1 ? `${n}(${c})` : n).join("  ");
}

export const ToolLine: Component<ToolBlockProps> = (props) => {
  const color = () => COLOR[props.tool.name] ?? "var(--text-3)";
  const icon = () => ICON[props.tool.name] ?? "⚙";
  return (
    <div style={{
      display: "flex",
      "align-items": "baseline",
      gap: "4px",
      padding: "1px 0",
      "font-size": "10px",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "border-left": `2px solid ${color()}`,
      "padding-left": "6px",
    }}>
      <span style={{ "flex-shrink": 0 }}>{icon()}</span>
      <span style={{ overflow: "hidden", "text-overflow": "ellipsis" }}>
        {renderCompact(props.tool.name, props.tool.input)}
      </span>
    </div>
  );
};

export interface ToolGroupProps {
  tools: ToolCall[];
}

export const ToolGroup: Component<ToolGroupProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div style={{ "margin-top": "6px" }}>
      <div
        onClick={() => setExpanded(!expanded())}
        style={{
          cursor: "pointer",
          "font-size": "10px",
          color: "var(--text-3)",
          display: "flex",
          "align-items": "center",
          gap: "4px",
          "user-select": "none",
          padding: "2px 0",
        }}
      >
        <span style={{
          display: "inline-block",
          width: "10px",
          "text-align": "center",
          "font-size": "8px",
          transition: "transform 0.15s",
          transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
        }}>▶</span>
        <span>⚙ {props.tools.length} tool{props.tools.length !== 1 ? "s" : ""}</span>
        <span style={{ color: "var(--text-3)", opacity: 0.7 }}>{toolSummary(props.tools)}</span>
      </div>
      <Show when={expanded()}>
        <div style={{ "padding-left": "14px", "margin-top": "2px", display: "flex", "flex-direction": "column", gap: "1px" }}>
          <For each={props.tools}>
            {(t) => <ToolLine tool={t} />}
          </For>
        </div>
      </Show>
    </div>
  );
};

// Keep the old ToolBlock export for backward compat if needed elsewhere
export const ToolBlock = ToolLine;
