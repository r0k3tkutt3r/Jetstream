import { Component, For } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { MessageRow } from "./Message";
import type { Message } from "../state/session-store";

export interface MessageListProps {
  messages: Message[];
  scrollRef: (el: HTMLDivElement) => void;
}

export const MessageList: Component<MessageListProps> = (props) => {
  let parentRef!: HTMLDivElement;

  const v = createVirtualizer({
    get count() { return props.messages.length; },
    getScrollElement: () => parentRef,
    estimateSize: () => 120,
    overscan: 8,
  });

  return (
    <div
      ref={(el) => { parentRef = el; props.scrollRef(el); }}
      style={{ flex: 1, "overflow-y": "auto", padding: "10px" }}
    >
      <div style={{ height: `${v.getTotalSize()}px`, position: "relative", width: "100%" }}>
        <For each={v.getVirtualItems()}>
          {(vi) => (
            <div
              ref={(el) => v.measureElement(el)}
              data-index={vi.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <MessageRow message={props.messages[vi.index]} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
