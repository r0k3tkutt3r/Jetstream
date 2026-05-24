import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Agent,
  CaffeinateStatus,
  CommandKind,
  CommandOutput,
  DirectoryConfig,
  PermissionMode,
  Preferences,
  SessionEvent,
  SessionSummary,
  SlashCommand,
} from "./types";

export const ipc = {
  spawnSession: (args: { cwd: string; name: string; agent?: string; resume_id?: string; model?: string; effort?: string }) =>
    invoke<SessionSummary>("spawn_session", { args }),

  sendUserMessage: (id: string, text: string) =>
    invoke<void>("send_user_message", { id, text }),

  cycleMode: (id: string) =>
    invoke<PermissionMode>("cycle_mode", { id }),

  interrupt: (id: string) =>
    invoke<void>("interrupt", { id }),

  listSessions: () =>
    invoke<SessionSummary[]>("list_sessions"),

  closeSession: (id: string) =>
    invoke<void>("close_session", { id }),

  renameSession: (id: string, name: string) =>
    invoke<void>("rename_session", { id, name }),

  switchModel: (id: string, model: string) =>
    invoke<SessionSummary>("switch_model", { id, model }),

  listAgents: () =>
    invoke<Agent[]>("list_agents"),

  caffeinateStatus: () =>
    invoke<CaffeinateStatus>("caffeinate_status"),

  listSlashCommands: () =>
    invoke<SlashCommand[]>("list_slash_commands"),

  replaySession: (id: string) =>
    invoke<void>("replay_session", { id }),

  resumeSession: (args: { id: string; cwd: string; name: string }) =>
    invoke<SessionSummary>("resume_session", { args }),

  getDefaultCwd: () => invoke<string>("get_default_cwd"),

  listSessionsForCwd: (cwd: string) =>
    invoke<SessionSummary[]>("list_sessions_for_cwd", { cwd }),

  getLastCwd: () => invoke<string | null>("get_last_cwd"),

  setLastCwd: (cwd: string) => invoke<void>("set_last_cwd", { cwd }),

  getDirectoryConfig: (cwd: string) =>
    invoke<DirectoryConfig>("get_directory_config", { cwd }),

  setDirectoryConfig: (cwd: string, config: DirectoryConfig) =>
    invoke<void>("set_directory_config", { cwd, config }),

  pickDirectory: () => invoke<string | null>("pick_directory"),

  runDirectoryCommand: (cwd: string, kind: CommandKind) =>
    invoke<CommandOutput>("run_directory_command", { cwd, kind }),

  getPreferences: () => invoke<Preferences>("get_preferences"),

  setPreferences: (prefs: Preferences) =>
    invoke<void>("set_preferences", { prefs }),

  startCommand: (cwd: string, kind: CommandKind) =>
    invoke<string>("start_command", { cwd, kind }),

  sendCommandInput: (data: string) =>
    invoke<void>("send_command_input", { data }),

  resizeCommand: (cols: number, rows: number) =>
    invoke<void>("resize_command", { cols, rows }),

  killCommand: () =>
    invoke<void>("kill_command"),

  getCommandBuffer: () =>
    invoke<number[]>("get_command_buffer"),
};

export async function subscribeSession(
  id: string,
  cb: (e: SessionEvent) => void
): Promise<UnlistenFn> {
  return listen<SessionEvent>(`session://${id}`, (e) => cb(e.payload));
}

export async function subscribeCommandOutput(
  cb: (data: number[]) => void,
): Promise<UnlistenFn> {
  return listen<{ data: number[] }>("command://output", (e) => cb(e.payload.data));
}

export async function subscribeCommandExit(
  cb: (exitCode: number, command: string) => void,
): Promise<UnlistenFn> {
  return listen<{ exit_code: number; command: string }>("command://exit", (e) =>
    cb(e.payload.exit_code, e.payload.command),
  );
}
