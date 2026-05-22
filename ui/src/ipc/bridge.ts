import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Agent, CaffeinateStatus, PermissionMode, SessionEvent, SessionSummary, SlashCommand } from "./types";

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
};

export async function subscribeSession(
  id: string,
  cb: (e: SessionEvent) => void
): Promise<UnlistenFn> {
  return listen<SessionEvent>(`session://${id}`, (e) => cb(e.payload));
}
