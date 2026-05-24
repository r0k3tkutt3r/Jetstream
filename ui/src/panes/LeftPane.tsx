import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { ipc } from "../ipc/bridge";
import { ConfirmDialog } from "../render/ConfirmDialog";
import type { CommandKind, DirectoryConfig, SessionSummary } from "../ipc/types";

export interface LeftPaneProps {
  activeId: string | null;
  cwd: string;
  activeIds: Set<string>;
  refreshKey: number;
  model: string;
  effort: string;
  commandRunning: CommandKind | null;
  onSetCwd: (cwd: string) => void;
  onSetModel: (m: string) => void;
  onSetEffort: (e: string) => void;
  onActivateSession: (s: SessionSummary) => void;
  onDeleteSession: (s: SessionSummary) => void;
  onClearAllSessions: (sessions: SessionSummary[]) => void;
  onRunCommand: (kind: CommandKind) => void;
  onKillCommand: () => void;
  onNewSession: () => void;
  onPickCwd: () => void;
  onShowToast: (kind: "success" | "error", title: string, body: string) => void;
  onRenameSession: (id: string, name: string) => void;
  getStoreName: (id: string) => string | null;
}

const MODELS = ["sonnet", "opus", "haiku"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const KINDS: CommandKind[] = ["run", "test", "build"];
const KIND_ICON: Record<CommandKind, string> = { run: "▶", test: "✓", build: "⚙" };

export const LeftPane: Component<LeftPaneProps> = (props) => {
  const [sessions] = createResource(
    () => [props.cwd, props.refreshKey] as const,
    async ([cwd]) => (cwd ? await ipc.listSessionsForCwd(cwd) : []),
  );

  const [config, { mutate: setConfig }] = createResource(
    () => props.cwd,
    async (cwd): Promise<DirectoryConfig> => {
      if (!cwd) return { run_command: "", test_command: "", build_command: "" };
      return await ipc.getDirectoryConfig(cwd);
    },
  );

  const [pendingDelete, setPendingDelete] = createSignal<SessionSummary | null>(null);
  const [confirmClearAll, setConfirmClearAll] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = (next: DirectoryConfig) => {
    if (saveTimer) clearTimeout(saveTimer);
    const cwd = props.cwd;
    saveTimer = setTimeout(() => {
      void ipc.setDirectoryConfig(cwd, next).catch(() => {});
    }, 400);
  };
  onCleanup(() => { if (saveTimer) clearTimeout(saveTimer); });

  const updateField = (kind: CommandKind, value: string) => {
    const cur = config() ?? { run_command: "", test_command: "", build_command: "" };
    const key = `${kind}_command` as keyof DirectoryConfig;
    const next: DirectoryConfig = { ...cur, [key]: value };
    setConfig(next);
    scheduleSave(next);
  };

  const fieldValue = (kind: CommandKind): string => {
    const c = config();
    if (!c) return "";
    return c[`${kind}_command` as keyof DirectoryConfig];
  };

  const running = () => props.commandRunning;

  return (
    <div class="pane">
      <div class="pane-header">
        <div style={{ "font-size": "11px", color: "var(--text-2)" }}>Workspace</div>
        <div style={{ cursor: "pointer", "font-size": "14px" }} onClick={props.onNewSession}>＋</div>
      </div>
      <div class="pane-body" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div>
          <div class="section-label" style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
            <span>Working directory</span>
            <span
              onClick={props.onPickCwd}
              title="Pick a folder (⌘O)"
              style={{ cursor: "pointer", color: "var(--text-2)", "font-size": "10px" }}
            >📁</span>
          </div>
          <input
            value={props.cwd}
            onChange={(e) => props.onSetCwd(e.currentTarget.value)}
            placeholder="/path/to/project"
            spellcheck={false}
            style={{
              width: "100%",
              "box-sizing": "border-box",
              "font-size": "10px",
              "font-family": "monospace",
              padding: "4px 6px",
              background: "var(--bg-2)",
              color: "var(--text-1)",
              border: "1px solid var(--border)",
              "border-radius": "3px",
            }}
            title="next session will use this cwd"
          />
        </div>

        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "8px" }}>
          <div>
            <div class="section-label">Model</div>
            <select
              value={props.model}
              onChange={(e) => props.onSetModel(e.currentTarget.value)}
              style={{
                width: "100%",
                "box-sizing": "border-box",
                "font-size": "11px",
                padding: "3px 4px",
                background: "var(--bg-2)",
                color: "var(--text-1)",
                border: "1px solid var(--border)",
                "border-radius": "3px",
              }}
            >
              <For each={MODELS}>{(m) => <option value={m}>{m}</option>}</For>
            </select>
          </div>
          <div>
            <div class="section-label">Effort</div>
            <select
              value={props.effort}
              onChange={(e) => props.onSetEffort(e.currentTarget.value)}
              style={{
                width: "100%",
                "box-sizing": "border-box",
                "font-size": "11px",
                padding: "3px 4px",
                background: "var(--bg-2)",
                color: "var(--text-1)",
                border: "1px solid var(--border)",
                "border-radius": "3px",
              }}
            >
              <For each={EFFORTS}>{(e) => <option value={e}>{e}</option>}</For>
            </select>
          </div>
        </div>

        <div>
          <div class="section-label" style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
            <span>Sessions</span>
            <Show when={(sessions() ?? []).length > 0}>
              <span
                onClick={() => setConfirmClearAll(true)}
                title="delete all sessions for this directory"
                style={{ cursor: "pointer", color: "var(--text-2)", "font-size": "10px" }}
              >clear all</span>
            </Show>
          </div>
          <For each={sessions() ?? []} fallback={<div style={{ color: "var(--text-3)", "font-size": "11px" }}>no sessions for this directory</div>}>
            {(s) => {
              const isLive = () => props.activeIds.has(s.id);
              const [hovered, setHovered] = createSignal(false);
              const handleDelete = (ev: MouseEvent) => {
                ev.stopPropagation();
                if (ev.shiftKey) {
                  props.onDeleteSession(s);
                  return;
                }
                setPendingDelete(s);
              };
              const displayName = () => props.getStoreName(s.id) || s.name || "(unnamed)";
              return (
                <div
                  onClick={() => props.onActivateSession(s)}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => setHovered(false)}
                  style={{
                    padding: "6px 8px",
                    "border-radius": "3px",
                    cursor: "pointer",
                    "margin-bottom": "4px",
                    background: props.activeId === s.id ? "var(--accent-bg)" : "transparent",
                    "border-left": props.activeId === s.id ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  <div style={{ "font-size": "11px", display: "flex", "justify-content": "space-between", "align-items": "center", gap: "6px" }}>
                    <Show when={editingId() === s.id} fallback={
                      <span
                        style={{ flex: 1, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
                      >{displayName()}</span>
                    }>
                      <input
                        ref={(el) => setTimeout(() => el.focus(), 0)}
                        value={editValue()}
                        onInput={(e) => setEditValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = editValue().trim();
                            if (val) props.onRenameSession(s.id, val);
                            setEditingId(null);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        onBlur={() => {
                          const val = editValue().trim();
                          if (val && val !== s.name) props.onRenameSession(s.id, val);
                          setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        spellcheck={false}
                        style={{
                          flex: 1,
                          "font-size": "11px",
                          padding: "1px 4px",
                          background: "var(--bg-2)",
                          color: "var(--text-1)",
                          border: "1px solid var(--accent)",
                          "border-radius": "2px",
                          outline: "none",
                          "min-width": 0,
                        }}
                      />
                    </Show>
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <Show when={!isLive()}>
                        <span style={{ "font-size": "8px", color: "var(--text-3)", opacity: 0.7 }}>saved</span>
                      </Show>
                      <Show when={hovered()}>
                        <span
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setEditingId(s.id);
                            setEditValue(displayName());
                          }}
                          title="rename session"
                          style={{
                            "font-size": "10px",
                            color: "var(--text-3)",
                            cursor: "pointer",
                            padding: "0 2px",
                            "line-height": 1,
                          }}
                        >✎</span>
                        <span
                          onClick={handleDelete}
                          title="delete session (shift+click to skip prompt)"
                          style={{
                            "font-size": "12px",
                            color: "var(--text-3)",
                            cursor: "pointer",
                            padding: "0 4px",
                            "line-height": 1,
                          }}
                        >×</span>
                      </Show>
                    </div>
                  </div>
                  <div style={{ "font-size": "9px", color: "var(--text-3)" }}>{s.mode}</div>
                </div>
              );
            }}
          </For>
        </div>

        <div style={{ "border-top": "1px solid var(--border)", "padding-top": "10px" }}>
          <div class="section-label">Project</div>
          <div style={{ display: "flex", gap: "4px", "margin-bottom": "8px" }}>
            <For each={KINDS}>
              {(k) => {
                const isRunning = () => running() === k;
                return (
                  <button
                    onClick={() => isRunning() ? props.onKillCommand() : props.onRunCommand(k)}
                    disabled={!isRunning() && (!fieldValue(k).trim() || running() !== null || !props.cwd)}
                    title={isRunning() ? `stop ${k}` : (fieldValue(k).trim() || `set ${k} command below`)}
                    style={{
                      flex: 1,
                      "font-size": "10px",
                      padding: "4px 6px",
                      background: isRunning() ? "#2a0f12" : "var(--bg-2)",
                      color: isRunning() ? "#fca5a5" : "var(--text-1)",
                      border: `1px solid ${isRunning() ? "#7f1d1d" : "var(--border)"}`,
                      "border-radius": "3px",
                      cursor: isRunning() || (fieldValue(k).trim() && !running()) ? "pointer" : "not-allowed",
                      opacity: isRunning() || (fieldValue(k).trim() && !running()) ? 1 : 0.5,
                      "text-transform": "capitalize",
                    }}
                  >
                    {isRunning() ? "■ stop" : `${KIND_ICON[k]} ${k}`}
                  </button>
                );
              }}
            </For>
          </div>
          <For each={KINDS}>
            {(k) => (
              <div style={{ "margin-bottom": "5px" }}>
                <div style={{ "font-size": "9px", color: "var(--text-3)", "margin-bottom": "2px", "text-transform": "capitalize" }}>{k}</div>
                <input
                  value={fieldValue(k)}
                  onInput={(e) => updateField(k, e.currentTarget.value)}
                  placeholder={`${k} command…`}
                  spellcheck={false}
                  style={{
                    width: "100%",
                    "box-sizing": "border-box",
                    "font-size": "10px",
                    "font-family": "monospace",
                    padding: "3px 6px",
                    background: "var(--bg-2)",
                    color: "var(--text-1)",
                    border: "1px solid var(--border)",
                    "border-radius": "3px",
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete() !== null}
        title="Delete session?"
        body={`Delete "${pendingDelete()?.name || pendingDelete()?.id.slice(0, 8) || ""}"? This removes it from the list and closes it if running.\n\nTip: hold shift while clicking × to skip this prompt.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const s = pendingDelete();
          if (s) props.onDeleteSession(s);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={confirmClearAll()}
        title="Clear all sessions?"
        body={`Delete all ${(sessions() ?? []).length} session(s) for this directory? Running sessions will be closed. This can't be undone.`}
        confirmLabel="Clear all"
        danger
        onConfirm={() => {
          props.onClearAllSessions(sessions() ?? []);
          setConfirmClearAll(false);
        }}
        onCancel={() => setConfirmClearAll(false)}
      />
    </div>
  );
};
