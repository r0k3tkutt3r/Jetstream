import { Component, For, createEffect, createSignal } from "solid-js";
import { MessageRow } from "./Message";
import type { Message } from "../state/session-store";

export interface MessageListProps {
  messages: Message[];
  scrollRef: (el: HTMLDivElement) => void;
  onAnswer?: (text: string) => void;
}

export const MessageList: Component<MessageListProps> = (props) => {
  let parentRef!: HTMLDivElement;
  const [stick, setStick] = createSignal(true);

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
      <For each={props.messages}>
        {(m) => <MessageRow message={m} onAnswer={props.onAnswer} />}
      </For>
    </div>
  );
};
