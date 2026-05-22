export type PermissionMode = "bypassPermissions" | "plan" | "acceptEdits" | "default";

export interface SessionSummary {
  id: string;
  name: string;
  cwd: string;
  mode: PermissionMode;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export type SessionEvent =
  | { type: "Assistant"; msg_id: string; delta: string }
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
