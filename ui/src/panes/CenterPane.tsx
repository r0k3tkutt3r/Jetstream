import { Component, For, Show, createResource, createSignal } from "solid-js";
import type { SessionStore } from "../state/session-store";
import { MessageList } from "../render/MessageList";
import { SlashPalette, matchSlash } from "../composer/SlashPalette";
import { ipc } from "../ipc/bridge";
import type { SlashCommand } from "../ipc/types";

export interface CenterPaneProps {
  session: SessionStore | null;
  onSend: (text: string) => void;
  onCycleMode: () => void;
}

export const CenterPane: Component<CenterPaneProps> = (props) => {
  const [input, setInput] = createSignal("");
  const [slashCommands] = createResource(() => ipc.listSlashCommands());
  const [highlight, setHighlight] = createSignal(0);

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
  };

  const busy = () => {
    const s = props.session?.status();
    return s === "thinking" || s === "tool";
  };

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
            <Show when={busy()}>
              <span style={{
                "font-size": "10px",
                color: "var(--accent)",
                display: "inline-flex",
                "align-items": "center",
                gap: "4px",
              }}>
                <span class="spinner" />
                {props.session!.lastActivity() ?? props.session!.status()}
              </span>
            </Show>
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
              onInput={(e) => { setInput(e.currentTarget.value); setHighlight(0); }}
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
