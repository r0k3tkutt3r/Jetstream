import { createSignal, type Accessor } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { PermissionMode, SessionEvent, Usage } from "../ipc/types";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface Message {
  id: string;          // msg_id from claude or "user-<n>"
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
  subagentRefs?: string[];   // ids of subagents dispatched in this message
}

export interface SubagentRecord {
  id: string;
  agent: string;
  prompt: string;
  startedAt: number;
  completed: boolean;
  result?: unknown;
}

export interface SessionStore {
  id: string;
  name: string;
  cwd: string;
  mode: Accessor<PermissionMode>;
  setMode: (m: PermissionMode) => void;
  status: Accessor<"idle" | "thinking" | "tool" | "error" | "closed">;
  messages: Accessor<Message[]>;
  subagents: Accessor<Record<string, SubagentRecord>>;
  usage: Accessor<Usage | null>;
  cost: Accessor<number>;

  handleEvent: (e: SessionEvent) => void;
  appendUserMessage: (text: string) => void;
  reset: () => void;
}

interface InitArgs {
  id: string;
  name: string;
  cwd: string;
  mode: PermissionMode;
}

export function createSessionStore(init: InitArgs): SessionStore {
  const [mode, setMode] = createSignal<PermissionMode>(init.mode);
  const [status, setStatus] = createSignal<"idle" | "thinking" | "tool" | "error" | "closed">("idle");
  const [messages, setMessages] = createStore<Message[]>([]);
  const [subagents, setSubagents] = createStore<Record<string, SubagentRecord>>({});
  const [usage, setUsage] = createSignal<Usage | null>(null);
  const [cost, setCost] = createSignal<number>(0);

  let userCounter = 0;

  function handleEvent(e: SessionEvent) {
    switch (e.type) {
      case "Assistant": {
        setMessages(produce((draft) => {
          const last = draft[draft.length - 1];
          if (last && last.role === "assistant" && last.id === e.msg_id) {
            last.content += e.delta;
          } else {
            draft.push({ id: e.msg_id, role: "assistant", content: e.delta, tools: [] });
          }
        }));
        setStatus("thinking");
        break;
      }
      case "Tool": {
        setMessages(produce((draft) => {
          const last = draft[draft.length - 1];
          if (last && last.role === "assistant") {
            last.tools ||= [];
            last.tools.push({ id: e.id, name: e.name, input: e.input });
          }
        }));
        setStatus("tool");
        break;
      }
      case "ToolResult": {
        setMessages(produce((draft) => {
          for (const m of draft) {
            if (!m.tools) continue;
            const t = m.tools.find((x) => x.id === e.id);
            if (t) { t.output = e.output; t.isError = e.is_error; }
          }
        }));
        break;
      }
      case "SubagentStart": {
        setSubagents(produce((draft) => {
          draft[e.id] = { id: e.id, agent: e.agent, prompt: e.prompt,
                          startedAt: Date.now(), completed: false };
        }));
        setMessages(produce((draft) => {
          const last = draft[draft.length - 1];
          if (last && last.role === "assistant") {
            last.subagentRefs ||= [];
            last.subagentRefs.push(e.id);
          }
        }));
        break;
      }
      case "SubagentStop": {
        setSubagents(produce((draft) => {
          if (draft[e.id]) {
            draft[e.id].completed = true;
            draft[e.id].result = e.result;
          }
        }));
        break;
      }
      case "Result": {
        setUsage(e.usage);
        setCost((c) => c + e.cost_usd);
        setStatus("idle");
        break;
      }
      case "Error": setStatus("error"); break;
      case "Closed": setStatus("closed"); break;
      default: break;
    }
  }

  function appendUserMessage(text: string) {
    userCounter += 1;
    setMessages(produce((draft) => {
      draft.push({ id: `user-${userCounter}`, role: "user", content: text });
    }));
  }

  function reset() {
    setMessages([]);
    setSubagents({});
    setUsage(null);
    setCost(0);
    setStatus("idle");
  }

  return {
    id: init.id,
    name: init.name,
    cwd: init.cwd,
    mode,
    setMode,
    status,
    messages: () => messages,
    subagents: () => subagents,
    usage,
    cost,
    handleEvent,
    appendUserMessage,
    reset,
  };
}
