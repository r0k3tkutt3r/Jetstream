import { Component, For, createEffect, createSignal, on } from "solid-js";
import { MessageRow } from "./Message";
import type { Message } from "../state/session-store";

export interface MessageListProps {
  messages: Message[];
  scrollRef: (el: HTMLDivElement) => void;
}

export const MessageList: Component<MessageListProps> = (props) => {
  let parentRef!: HTMLDivElement;
  const [stick, setStick] = createSignal(true);

  // Re-stick to bottom when message count grows or last message content grows
  createEffect(on(
    () => [props.messages.length, props.messages[props.messages.length - 1]?.content.length],
    () => {
      if (stick()) {
        queueMicrotask(() => parentRef?.scrollTo({ top: parentRef.scrollHeight }));
      }
    },
  ));

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
        {(m) => <MessageRow message={m} />}
      </For>
    </div>
  );
};
