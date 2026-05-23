import { Component, For, Show, createResource, createSignal, onCleanup } from "solid-js";
import { ipc } from "../ipc/bridge";
import type { CommandKind, CommandOutput, DirectoryConfig, SessionSummary } from "../ipc/types";

export interface LeftPaneProps {
  activeId: string | null;
  cwd: string;
  activeIds: Set<string>;
  refreshKey: number;
  onSetCwd: (cwd: string) => void;
  onActivateSession: (s: SessionSummary) => void;
  onNewSession: () => void;
  onPickCwd: () => void;
  onShowToast: (kind: "success" | "error", title: string, body: string) => void;
}

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

  const [running, setRunning] = createSignal<CommandKind | null>(null);

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

  const runCommand = async (kind: CommandKind) => {
    const value = fieldValue(kind).trim();
    if (!value || !props.cwd) return;
    setRunning(kind);
    try {
      const out: CommandOutput = await ipc.runDirectoryCommand(props.cwd, kind);
      const ok = out.exit_code === 0;
      const tail = [out.stdout_tail, out.stderr_tail].filter(Boolean).join("\n").trim();
      const body = `$ ${out.command}\nexit ${out.exit_code}${tail ? "\n\n" + tail : ""}`;
      props.onShowToast(ok ? "success" : "error", `${kind} ${ok ? "ok" : "failed"}`, body);
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
      props.onShowToast("error", `${kind} failed`, msg);
    } finally {
      setRunning(null);
    }
  };

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

        <div>
          <div class="section-label">Sessions</div>
          <For each={sessions() ?? []} fallback={<div style={{ color: "var(--text-3)", "font-size": "11px" }}>no sessions for this directory</div>}>
            {(s) => {
              const isLive = () => props.activeIds.has(s.id);
              return (
                <div
                  onClick={() => props.onActivateSession(s)}
                  style={{
                    padding: "6px 8px",
                    "border-radius": "3px",
                    cursor: "pointer",
                    "margin-bottom": "4px",
                    background: props.activeId === s.id ? "var(--accent-bg)" : "transparent",
                    "border-left": props.activeId === s.id ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  <div style={{ "font-size": "11px", display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                    <span>{s.name || "(unnamed)"}</span>
                    <Show when={!isLive()}>
                      <span style={{ "font-size": "8px", color: "var(--text-3)", opacity: 0.7 }}>saved</span>
                    </Show>
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
              {(k) => (
                <button
                  onClick={() => void runCommand(k)}
                  disabled={!fieldValue(k).trim() || running() !== null || !props.cwd}
                  title={fieldValue(k).trim() || `set ${k} command below`}
                  style={{
                    flex: 1,
                    "font-size": "10px",
                    padding: "4px 6px",
                    background: running() === k ? "var(--accent-bg)" : "var(--bg-2)",
                    color: "var(--text-1)",
                    border: "1px solid var(--border)",
                    "border-radius": "3px",
                    cursor: fieldValue(k).trim() && !running() ? "pointer" : "not-allowed",
                    opacity: fieldValue(k).trim() && !running() ? 1 : 0.5,
                    "text-transform": "capitalize",
                  }}
                >
                  {KIND_ICON[k]} {k}
                </button>
              )}
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
    </div>
  );
};
