export type PermissionMode = "bypassPermissions" | "plan" | "acceptEdits" | "default";

export interface SessionSummary {
  id: string;
  name: string;
  cwd: string;
  mode: PermissionMode;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type SessionEvent =
  | { type: "Assistant"; msg_id: string; delta: string; is_final?: boolean }
  | { type: "Tool"; id: string; name: string; input: unknown }
  | { type: "ToolResult"; id: string; output: unknown; is_error: boolean }
  | { type: "SubagentStart"; id: string; agent: string; prompt: string }
  | { type: "SubagentStop"; id: string; result: unknown }
  | { type: "Hook"; event: string; payload: unknown }
  | { type: "Result"; usage: Usage; cost_usd: number }
  | { type: "Resync" }
  | { type: "Error"; message: string; recoverable: boolean }
  | { type: "Closed"; code: number };

export interface Agent {
  name: string;
  description: string;
  model?: string;
}

export interface CaffeinateStatus {
  active: boolean;
  refcount: number;
}

export interface SlashCommand {
  name: string;
  description: string;
  argument_hint: string | null;
}

export interface DirectoryConfig {
  run_command: string;
  test_command: string;
  build_command: string;
}

export interface CommandOutput {
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  command: string;
}

export type CommandKind = "run" | "test" | "build";
