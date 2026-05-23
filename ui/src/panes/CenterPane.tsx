import { Component, For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import type { SessionStore } from "../state/session-store";
import { MessageList } from "../render/MessageList";
import { TodoPanel } from "../render/TodoPanel";
import { SlashPalette, matchSlash } from "../composer/SlashPalette";
import { ipc } from "../ipc/bridge";
import type { SlashCommand } from "../ipc/types";

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export interface CenterPaneProps {
  session: SessionStore | null;
  model: string;
  effort: string;
  onSend: (text: string) => void;
  onCycleMode: () => void;
}

export const CenterPane: Component<CenterPaneProps> = (props) => {
  const [input, setInput] = createSignal("");
  const [slashCommands] = createResource(() => ipc.listSlashCommands());
  const [highlight, setHighlight] = createSignal(0);
  // Up/Down history navigation. -1 = not in history; 0..N-1 indexes from newest.
  const [historyIdx, setHistoryIdx] = createSignal(-1);
  const [historyDraft, setHistoryDraft] = createSignal("");

  const isSlashOpen = () => input().startsWith("/") && !input().includes(" ");
  const slashQuery = () => input().slice(1).toLowerCase();

  const acceptSlash = (c: SlashCommand) => {
    setInput(`/${c.name} `);
    setHighlight(0);
  };

  const submit = () => {
    const t = input().trim();
    if (!t) return;
    props.onSend(t);
    setInput("");
    setHighlight(0);
    setHistoryIdx(-1);
    setHistoryDraft("");
  };

  // Returns true if the keystroke was consumed by history navigation.
  const tryHistoryNav = (e: KeyboardEvent, dir: "up" | "down"): boolean => {
    const ta = e.currentTarget as HTMLTextAreaElement;
    const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    const empty = input() === "";
    const inHistoryMode = historyIdx() !== -1;
    // First entry into history requires empty / cursor-at-start. Once in
    // history mode, keep cycling regardless of cursor position.
    if (!inHistoryMode && !empty && !atStart) return false;
    const hist = props.session?.history() ?? [];
    if (hist.length === 0) return false;
    let idx = historyIdx();
    if (dir === "up") {
      if (idx === -1) {
        setHistoryDraft(input());
        idx = hist.length - 1;
      } else if (idx > 0) {
        idx -= 1;
      } else {
        return true; // already at oldest; consume to avoid cursor move
      }
    } else {
      if (idx === -1) return false;
      if (idx < hist.length - 1) {
        idx += 1;
      } else {
        setHistoryIdx(-1);
        setInput(historyDraft());
        return true;
      }
    }
    setHistoryIdx(idx);
    setInput(hist[idx]);
    queueMicrotask(() => {
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
    return true;
  };

  const busy = () => {
    const s = props.session?.status();
    return s === "thinking" || s === "tool";
  };

  // Tick once per second only while busy so the elapsed-time string refreshes.
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!busy()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(t));
  });

  return (
    <div class="pane">
      <Show when={props.session} fallback={
        <div style={{ flex: 1, display: "grid", "place-items": "center", color: "var(--text-3)" }}>
          Pick or start a session
        </div>
      }>
        <div class="pane-header">
          <div>
            <div style={{ "font-size": "12px" }}>{props.session!.name}</div>
            <div style={{ "font-size": "9px", color: "var(--text-3)" }}>
              {props.session!.cwd} · {props.session!.id.slice(0, 8)}…
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
            <span style={{
              color: "var(--text-3)",
              "font-size": "9px",
              "font-family": "monospace",
              background: "var(--bg-2)",
              padding: "2px 6px",
              "border-radius": "10px",
            }} title="model · effort (from preferences)">{props.model} · {props.effort}</span>
            <span
              onClick={props.onCycleMode}
              style={{
                background: modeColor(props.session!.mode()),
                color: "white",
                "font-size": "9px",
                padding: "2px 8px",
                "border-radius": "10px",
                cursor: "pointer",
              }}
            >{props.session!.mode()}</span>
            <span style={{ color: "var(--text-3)", "font-size": "10px" }}>⇧⇥ to cycle</span>
          </div>
        </div>

        <MessageList
          messages={props.session!.messages()}
          scrollRef={() => {}}
        />

        <TodoPanel todos={props.session!.todos()} />

        <Show when={busy()}>
          <div style={{
            padding: "4px 12px 6px",
            "font-size": "12px",
            "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
            display: "flex",
            "align-items": "center",
            gap: "6px",
          }}>
            <span style={{ color: "var(--accent)" }}>✻</span>
            <span style={{ color: "var(--accent)" }}>
              {(() => {
                const a = props.session!.lastActivity() ?? props.session!.status();
                return a.endsWith("…") ? a : `${a}…`;
              })()}
            </span>
            <span style={{ color: "var(--text-3)" }}>
              (<Show
                when={props.session!.turnStartedAt()}
                fallback={<>warming up</>}
              >
                {fmtElapsed(now() - props.session!.turnStartedAt()!)}
              </Show>
              <Show
                when={props.session!.turnOutputTokens() > 0}
                fallback={
                  <Show when={props.session!.turnInputTokens() > 0}>
                    <> · ↓ {fmtTokens(props.session!.turnInputTokens())} tokens</>
                  </Show>
                }
              >
                <> · ↑ {fmtTokens(props.session!.turnOutputTokens())} tokens</>
              </Show>
              <Show when={props.session!.status() === "thinking"}>
                <> · thinking with {props.effort} effort</>
              </Show>
              )
            </span>
          </div>
        </Show>

        <div style={{ "border-top": "1px solid var(--border)", padding: "8px 12px" }}>
          <Show when={(props.session?.queue() ?? []).length > 0}>
            <div style={{
              "font-size": "10px",
              color: "var(--text-3)",
              "margin-bottom": "6px",
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
            }}>
              <For each={props.session!.queue()}>
                {(q, i) => (
                  <div style={{
                    background: "var(--bg-2)",
                    padding: "3px 8px",
                    "border-radius": "3px",
                    "border-left": "2px solid var(--text-3)",
                  }}>
                    queued #{i() + 1}: <span style={{ color: "var(--text-2)" }}>{q.length > 80 ? q.slice(0, 77) + "…" : q}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div style={{ position: "relative" }}>
            <Show when={isSlashOpen() && slashCommands()}>
              <SlashPalette
                query={slashQuery()}
                commands={slashCommands()!}
                highlightIndex={highlight()}
                onAccept={acceptSlash}
                onHighlight={setHighlight}
              />
            </Show>
            <textarea
              value={input()}
              onInput={(e) => {
                setInput(e.currentTarget.value);
                setHighlight(0);
                // Any manual edit exits history mode; current text becomes the new draft.
                if (historyIdx() !== -1) {
                  setHistoryIdx(-1);
                  setHistoryDraft(e.currentTarget.value);
                }
              }}
              onKeyDown={(e) => {
                if (isSlashOpen() && slashCommands()) {
                  const cmds = slashCommands()!;
                  const matches = matchSlash(slashQuery(), cmds);
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, matches.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                    return;
                  }
                  // Only Tab (without shift) and Enter accept — Shift+Tab falls through to global mode-cycle
                  if (((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") && matches.length > 0 && !e.shiftKey) {
                    e.preventDefault();
                    acceptSlash(matches[highlight()]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    setHighlight(0);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                  return;
                }
                if (e.key === "ArrowUp" && tryHistoryNav(e, "up")) {
                  e.preventDefault();
                  return;
                }
                if (e.key === "ArrowDown" && tryHistoryNav(e, "down")) {
                  e.preventDefault();
                  return;
                }
              }}
              placeholder={busy() ? "› queue a message (sent when current turn ends)" : "› message (Enter to send, Shift+Enter for newline)"}
              rows={2}
              style={{
                width: "100%",
                background: "var(--bg-0)",
                color: "var(--text-1)",
                border: "1px solid var(--border)",
                "border-radius": "6px",
                padding: "8px 10px",
                "font-family": "inherit",
                "font-size": "12px",
                resize: "none",
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};

function modeColor(mode: string): string {
  switch (mode) {
    case "bypassPermissions": return "var(--mode-bypass)";
    case "plan":              return "var(--mode-plan)";
    case "acceptEdits":       return "var(--mode-accept)";
    default:                  return "var(--mode-default)";
  }
}
