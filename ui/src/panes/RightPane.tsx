import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { ipc } from "../ipc/bridge";
import { renderMarkdown } from "../render/markdown";
import type { SessionStore, SubagentRecord } from "../state/session-store";

export interface RightPaneProps {
  session: SessionStore | null;
  model: string;
}

function contextWindowForModel(model: string): number {
  if (model === "opus") return 1_000_000;
  return 200_000;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function clampStr(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function resultToText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.content === "string") return r.content;
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.content)) {
      return r.content
        .map((b: any) => (typeof b === "string" ? b : b?.text ?? ""))
        .join("\n");
    }
  }
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

const SubagentDetail: Component<{ record: SubagentRecord; onBack: () => void }> = (props) => {
  const elapsed = () => {
    if (!props.record.completed) return fmtElapsed(Date.now() - props.record.startedAt);
    return "";
  };
  const resultText = () => resultToText(props.record.result);

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": 0 }}>
      <div style={{
        padding: "6px 10px",
        "border-bottom": "1px solid var(--border)",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        "flex-shrink": 0,
      }}>
        <span
          onClick={props.onBack}
          style={{ cursor: "pointer", color: "var(--text-2)", "font-size": "12px" }}
          title="Back to list"
        >&larr;</span>
        <span style={{ "font-size": "11px", "font-weight": 600, color: "var(--tool-subagent)" }}>
          {props.record.agent}
        </span>
        <span style={{
          "margin-left": "auto",
          "font-size": "9px",
          padding: "1px 6px",
          "border-radius": "8px",
          background: props.record.completed ? "var(--bg-2)" : "var(--accent-bg)",
          color: props.record.completed ? "var(--text-3)" : "var(--accent)",
        }}>
          {props.record.completed ? "done" : "running"}
        </span>
      </div>
      <div style={{ flex: 1, "overflow-y": "auto", padding: "8px 10px", "min-height": 0 }}>
        <Show when={props.record.description}>
          <div style={{ "margin-bottom": "8px" }}>
            <div style={{ "font-size": "9px", color: "var(--text-3)", "margin-bottom": "2px" }}>Description</div>
            <div style={{ "font-size": "11px", color: "var(--text-1)" }}>{props.record.description}</div>
          </div>
        </Show>
        <Show when={props.record.prompt}>
          <div style={{ "margin-bottom": "8px" }}>
            <div style={{ "font-size": "9px", color: "var(--text-3)", "margin-bottom": "2px" }}>Prompt</div>
            <div style={{
              "font-size": "10px",
              color: "var(--text-2)",
              background: "var(--bg-0)",
              padding: "6px 8px",
              "border-radius": "4px",
              "max-height": "120px",
              "overflow-y": "auto",
              "white-space": "pre-wrap",
              "word-break": "break-word",
            }}>{props.record.prompt}</div>
          </div>
        </Show>
        <Show when={!props.record.completed}>
          <div style={{ "font-size": "10px", color: "var(--accent)" }}>
            Running {elapsed()}
          </div>
        </Show>
        <Show when={props.record.completed && resultText()}>
          <div>
            <div style={{ "font-size": "9px", color: "var(--text-3)", "margin-bottom": "2px" }}>Output</div>
            <div style={{
              "font-size": "11px",
              background: "var(--bg-0)",
              padding: "8px 10px",
              "border-radius": "4px",
              "overflow-y": "auto",
              "word-break": "break-word",
            }} innerHTML={renderMarkdown({ id: "", content: resultText() })} />
          </div>
        </Show>
        <Show when={props.record.completed && !resultText()}>
          <div style={{ "font-size": "10px", color: "var(--text-3)" }}>
            Completed (no output)
          </div>
        </Show>
        <div style={{ "margin-top": "8px", "font-size": "9px", color: "var(--text-3)" }}>
          ID: {props.record.id.slice(0, 12)}
        </div>
      </div>
    </div>
  );
};

export const RightPane: Component<RightPaneProps> = (props) => {
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 2000);
  onCleanup(() => clearInterval(tickInterval));

  const [caf] = createResource(tick, () => ipc.caffeinateStatus());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const active = () => Object.values(props.session?.subagents() ?? {}).filter((s) => !s.completed);
  const done   = () => Object.values(props.session?.subagents() ?? {}).filter((s) =>  s.completed).slice(-5);

  const selectedRecord = () => {
    const id = selectedId();
    if (!id || !props.session) return null;
    return props.session.subagents()[id] ?? null;
  };

  const liveContextTokens = () => {
    void tick();
    const turnIn = props.session?.turnInputTokens() ?? 0;
    const turnOut = props.session?.turnOutputTokens() ?? 0;
    if (turnIn > 0) return turnIn + turnOut;
    return props.session?.contextUsage() ?? 0;
  };

  const contextWindow = () => contextWindowForModel(props.model);
  const ctxPct = () => Math.min(100, (liveContextTokens() / contextWindow()) * 100);

  const liveCost = () => {
    void tick();
    const settled = props.session?.cost() ?? 0;
    const inInput = props.session?.turnInputTokens() ?? 0;
    const inOutput = props.session?.turnOutputTokens() ?? 0;
    const turnEst = (inInput * 3 + inOutput * 15) / 1_000_000;
    return settled + turnEst;
  };

  return (
    <div class="pane" style={{ display: "flex", "flex-direction": "column" }}>
      <Show when={selectedRecord()} fallback={
        <>
          <div class="pane-header">
            <div style={{ "font-size": "11px", color: "var(--text-2)" }}>Subagents</div>
            <div style={{ "font-size": "9px", color: "var(--text-3)" }}>{active().length} active</div>
          </div>
          <div class="pane-body">
            <Show when={props.session} fallback={<div style={{ color: "var(--text-3)" }}>&mdash;</div>}>
              <For each={active()}>
                {(s) => (
                  <div
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      background: "var(--accent-bg)",
                      "border-left": "2px solid var(--accent)",
                      padding: "8px",
                      "border-radius": "4px",
                      "margin-bottom": "6px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ "font-size": "10px", "font-weight": 600 }}>{s.agent}</div>
                    <Show when={s.description}>
                      <div style={{ "font-size": "9px", color: "var(--text-2)" }}>{clampStr(s.description, 80)}</div>
                    </Show>
                    <Show when={!s.description && s.prompt}>
                      <div style={{ "font-size": "9px", color: "var(--text-2)" }}>{clampStr(s.prompt, 80)}</div>
                    </Show>
                  </div>
                )}
              </For>
              <For each={done()}>
                {(s) => (
                  <div
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      padding: "4px 8px",
                      "border-radius": "3px",
                      color: "var(--text-3)",
                      "font-size": "10px",
                      opacity: 0.8,
                      cursor: "pointer",
                    }}
                  >
                    {s.agent} &middot; {s.description ? clampStr(s.description, 50) : "done"}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </>
      }>
        {(rec) => (
          <SubagentDetail record={rec()} onBack={() => setSelectedId(null)} />
        )}
      </Show>
      <div style={{ "margin-top": "auto" }}>
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
              <span>{fmtTokens(liveContextTokens())} / {fmtTokens(contextWindow())}</span>
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
                <div>in: {fmtTokens(props.session!.usage()!.input_tokens)} &middot; out: {fmtTokens(props.session!.usage()!.output_tokens)}</div>
                <div>cache r: {fmtTokens(props.session!.usage()!.cache_read_input_tokens)} &middot; w: {fmtTokens(props.session!.usage()!.cache_creation_input_tokens)}</div>
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
          <span>{caf()?.active ? `holding ${caf()?.refcount}` : "off"}</span>
          <span>${liveCost().toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
};
