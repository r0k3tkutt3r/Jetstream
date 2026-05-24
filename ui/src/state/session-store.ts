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

export interface SubagentRef {
  id: string;
  agent: string;
  description: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolCall[];
  subagentRefs?: SubagentRef[];
}

export interface SubagentRecord {
  id: string;
  agent: string;
  description: string;
  prompt: string;
  startedAt: number;
  completed: boolean;
  result?: unknown;
}

export interface Todo {
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

export type SessionStatus = "idle" | "thinking" | "tool" | "error" | "closed";

export interface SessionStore {
  id: string;
  name: Accessor<string>;
  setName: (n: string) => void;
  cwd: string;
  onResult: ((store: SessionStore) => void) | null;
  mode: Accessor<PermissionMode>;
  setMode: (m: PermissionMode) => void;
  status: Accessor<SessionStatus>;
  messages: Accessor<Message[]>;
  subagents: Accessor<Record<string, SubagentRecord>>;
  usage: Accessor<Usage | null>;
  cost: Accessor<number>;
  cumulativeTokens: Accessor<number>;
  queue: Accessor<string[]>;
  history: Accessor<string[]>;
  pushHistory: (text: string) => void;
  lastActivity: Accessor<string | null>;
  turnStartedAt: Accessor<number | null>;
  turnInputTokens: Accessor<number>;
  turnOutputTokens: Accessor<number>;
  todos: Accessor<Todo[]>;
  draft: Accessor<string>;
  setDraft: (text: string) => void;

  handleEvent: (e: SessionEvent) => void;
  appendUserMessage: (text: string) => void;
  appendSyntheticAssistant: (text: string) => void;
  markRespawning: () => void;
  enqueue: (text: string) => void;
  drainQueue: () => string[];
  reset: () => void;
}

interface InitArgs {
  id: string;
  name: string;
  cwd: string;
  mode: PermissionMode;
}

export function createSessionStore(init: InitArgs): SessionStore {
  const [name, setName] = createSignal<string>(init.name);
  const [mode, setMode] = createSignal<PermissionMode>(init.mode);
  const [status, setStatus] = createSignal<SessionStatus>("idle");
  const [messages, setMessages] = createStore<Message[]>([]);
  const [subagents, setSubagents] = createStore<Record<string, SubagentRecord>>({});
  const [usage, setUsage] = createSignal<Usage | null>(null);
  const [cost, setCost] = createSignal<number>(0);
  const [cumulativeTokens, setCumulativeTokens] = createSignal<number>(0);
  const [queue, setQueue] = createStore<string[]>([]);
  const [history, setHistory] = createSignal<string[]>([]);
  const HISTORY_CAP = 5;
  function pushHistory(text: string) {
    const t = text.trim();
    if (!t) return;
    setHistory((cur) => {
      const without = cur.filter((x) => x !== t);
      const next = [...without, t];
      return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    });
  }
  const [lastActivity, setLastActivity] = createSignal<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = createSignal<number | null>(null);
  const [turnInputTokens, setTurnInputTokens] = createSignal<number>(0);
  const [turnOutputTokens, setTurnOutputTokens] = createSignal<number>(0);
  const [todos, setTodos] = createSignal<Todo[]>([]);
  const [draft, setDraft] = createSignal<string>("");

  function markTurnStart() {
    if (turnStartedAt() === null) {
      setTurnStartedAt(Date.now());
      setTurnInputTokens(0);
      setTurnOutputTokens(0);
    }
  }
  function markTurnEnd() {
    setTurnStartedAt(null);
    setTurnInputTokens(0);
    setTurnOutputTokens(0);
  }

  let userCounter = 0;
  let respawning = false;
  function markRespawning() {
    respawning = true;
  }

  function handleEvent(e: SessionEvent) {
    switch (e.type) {
      case "Assistant": {
        setMessages(produce((draft) => {
          const existingIdx = draft.findIndex((m) => m.role === "assistant" && m.id === e.msg_id);
          if (existingIdx >= 0) {
            if (e.is_final) {
              draft[existingIdx].content = e.delta;
            } else {
              draft[existingIdx].content += e.delta;
            }
          } else {
            draft.push({ id: e.msg_id, role: "assistant", content: e.delta, tools: [] });
          }
        }));
        setStatus("thinking");
        setLastActivity("responding");
        markTurnStart();
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
        if (e.name === "TodoWrite") {
          const input = e.input as { todos?: unknown } | null;
          if (input && Array.isArray(input.todos)) {
            setTodos(input.todos.filter((t): t is Todo =>
              !!t && typeof t === "object"
              && typeof (t as Todo).subject === "string"
              && typeof (t as Todo).status === "string"
            ));
          }
        }
        if (e.name === "Agent") {
          const input = e.input as { subagent_type?: string; description?: string; prompt?: string } | null;
          const agentName = input?.subagent_type ?? "agent";
          const agentDesc = input?.description ?? "";
          const agentPrompt = input?.prompt ?? "";
          setSubagents(produce((draft) => {
            draft[e.id] = { id: e.id, agent: agentName, description: agentDesc,
                            prompt: agentPrompt, startedAt: Date.now(), completed: false };
          }));
          setMessages(produce((draft) => {
            const last = draft[draft.length - 1];
            if (last && last.role === "assistant") {
              last.subagentRefs ||= [];
              last.subagentRefs.push({ id: e.id, agent: agentName, description: agentDesc });
            }
          }));
        }
        setStatus("tool");
        setLastActivity(`${e.name}…`);
        markTurnStart();
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
        // Complete any subagent that was started by the matching Agent tool call
        setSubagents(produce((draft) => {
          if (draft[e.id]) {
            draft[e.id].completed = true;
            draft[e.id].result = e.output;
          }
        }));
        break;
      }
      case "SubagentStart": {
        setSubagents(produce((draft) => {
          draft[e.id] = { id: e.id, agent: e.agent, description: "",
                          prompt: e.prompt, startedAt: Date.now(), completed: false };
        }));
        setMessages(produce((draft) => {
          const last = draft[draft.length - 1];
          if (last && last.role === "assistant") {
            last.subagentRefs ||= [];
            last.subagentRefs.push({ id: e.id, agent: e.agent, description: "" });
          }
        }));
        setLastActivity(`agent: ${e.agent}`);
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
        const turnTokens =
          (e.usage?.input_tokens ?? 0) +
          (e.usage?.output_tokens ?? 0) +
          (e.usage?.cache_read_input_tokens ?? 0) +
          (e.usage?.cache_creation_input_tokens ?? 0);
        setCumulativeTokens((n) => n + turnTokens);
        setStatus("idle");
        setLastActivity(null);
        markTurnEnd();
        if (self.onResult) self.onResult(self);
        break;
      }
      case "TurnUpdate": {
        if (e.input_tokens > 0) setTurnInputTokens(e.input_tokens);
        if (e.output_tokens > 0) setTurnOutputTokens(e.output_tokens);
        // Receiving a TurnUpdate before any Assistant/Tool event means we
        // arrived via message_start during the "loading" phase — mark turn
        // start so the elapsed timer is shown.
        markTurnStart();
        break;
      }
      case "Error": setStatus("error"); setLastActivity("error"); markTurnEnd(); break;
      case "Closed":
        if (respawning) {
          // Suppress the Closed produced by the old child during model switch.
          respawning = false;
          markTurnEnd();
          break;
        }
        setStatus("closed");
        setLastActivity("closed");
        markTurnEnd();
        break;
      case "Resync":
        respawning = false;
        setStatus("idle");
        setLastActivity(null);
        markTurnEnd();
        break;
      default: break;
    }
  }

  function appendUserMessage(text: string) {
    userCounter += 1;
    setMessages(produce((draft) => {
      draft.push({ id: `user-${userCounter}`, role: "user", content: text });
    }));
  }

  let syntheticCounter = 0;
  function appendSyntheticAssistant(text: string) {
    syntheticCounter += 1;
    setMessages(produce((draft) => {
      draft.push({ id: `synth-${syntheticCounter}`, role: "assistant", content: text });
    }));
  }

  function enqueue(text: string) {
    setQueue(produce((q) => { q.push(text); }));
  }

  function drainQueue(): string[] {
    const items = [...queue];
    setQueue([]);
    return items;
  }

  function reset() {
    setMessages([]);
    setSubagents({});
    setUsage(null);
    setCost(0);
    setCumulativeTokens(0);
    setQueue([]);
    setStatus("idle");
    setLastActivity(null);
    setTodos([]);
  }

  const self: SessionStore = {
    id: init.id,
    name,
    setName,
    cwd: init.cwd,
    onResult: null,
    mode,
    setMode,
    status,
    messages: () => messages,
    subagents: () => subagents,
    usage,
    cost,
    cumulativeTokens,
    queue: () => queue,
    history,
    pushHistory,
    lastActivity,
    turnStartedAt,
    turnInputTokens,
    turnOutputTokens,
    todos,
    draft,
    setDraft,
    handleEvent,
    appendUserMessage,
    appendSyntheticAssistant,
    markRespawning,
    enqueue,
    drainQueue,
    reset,
  };
  return self;
}
