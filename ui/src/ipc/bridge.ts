import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Agent,
  CaffeinateStatus,
  CommandKind,
  CommandOutput,
  DirectoryConfig,
  PermissionMode,
  SessionEvent,
  SessionSummary,
  SlashCommand,
} from "./types";

export const ipc = {
  spawnSession: (args: { cwd: string; name: string; agent?: string; resume_id?: string }) =>
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
};

export async function subscribeSession(
  id: string,
  cb: (e: SessionEvent) => void
): Promise<UnlistenFn> {
  return listen<SessionEvent>(`session://${id}`, (e) => cb(e.payload));
}
