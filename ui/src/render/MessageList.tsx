import { Component, For, createEffect, createMemo, createSignal } from "solid-js";
import { MessageRow, AssistantMessageGroup } from "./Message";
import type { Message } from "../state/session-store";

export interface MessageListProps {
  messages: Message[];
  scrollRef: (el: HTMLDivElement) => void;
  onAnswer?: (text: string) => void;
}

type MsgGroup =
  | { role: "user"; message: Message }
  | { role: "assistant"; messages: Message[] };

function groupMessages(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const last = groups[groups.length - 1];
      if (last?.role === "assistant") {
        last.messages.push(m);
      } else {
        groups.push({ role: "assistant", messages: [m] });
      }
    } else {
      groups.push({ role: "user", message: m });
    }
  }
  return groups;
}

export const MessageList: Component<MessageListProps> = (props) => {
  let parentRef!: HTMLDivElement;
  const [stick, setStick] = createSignal(true);

  const groups = createMemo(() => groupMessages(props.messages));

  // Re-stick to bottom when messages grow, content streams, or user scrolls back to bottom
  createEffect(() => {
    const msgs = props.messages;
    const len = msgs.length;
    if (len > 0) {
      // Track last message content so streaming deltas re-trigger the effect
      void msgs[len - 1].content;
    }
    if (stick()) {
      queueMicrotask(() => parentRef?.scrollTo({ top: parentRef.scrollHeight }));
    }
  });

  const onScroll = () => {
    if (!parentRef) return;
    const near = parentRef.scrollHeight - parentRef.scrollTop - parentRef.clientHeight < 64;
    setStick(near);
  };

  return (
    <div
      ref={(el) => { parentRef = el; props.scrollRef(el); }}
      onScroll={onScroll}
      style={{ flex: 1, "overflow-y": "auto", padding: "10px", "min-height": 0 }}
    >
      <For each={groups()}>
        {(g) => {
          if (g.role === "assistant") {
            return <AssistantMessageGroup messages={g.messages} onAnswer={props.onAnswer} />;
          }
          return <MessageRow message={g.message} onAnswer={props.onAnswer} />;
        }}
      </For>
    </div>
  );
};
