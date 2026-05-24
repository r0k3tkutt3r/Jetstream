import { Component, For } from "solid-js";

export interface SessionNotif {
  id: number;
  sessionId: string;
  sessionName: string;
  reason: "done" | "question";
  timestamp: number;
}

export interface SessionNotificationProps {
  notifications: SessionNotif[];
  onDismiss: (id: number) => void;
  onClick: (sessionId: string) => void;
}

export const SessionNotificationStack: Component<SessionNotificationProps> = (props) => {
  return (
    <div style={{
      position: "fixed",
      bottom: "16px",
      left: "16px",
      display: "flex",
      "flex-direction": "column-reverse",
      gap: "8px",
      "z-index": 9999,
      "max-width": "300px",
      "pointer-events": "none",
    }}>
      <For each={props.notifications.slice(0, 3)}>
        {(n) => (
          <div
            onClick={() => props.onClick(n.sessionId)}
            style={{
              "pointer-events": "auto",
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              "border-radius": "6px",
              padding: "10px 12px",
              cursor: "pointer",
              "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
              animation: "slideInLeft 0.2s ease-out",
            }}
          >
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
              <span style={{ "font-size": "11px", "font-weight": "bold", color: "var(--text-1)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "220px" }}>
                {n.sessionName}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); props.onDismiss(n.id); }}
                style={{ "font-size": "12px", color: "var(--text-3)", cursor: "pointer", padding: "0 4px" }}
              >×</span>
            </div>
            <div style={{ "font-size": "10px", color: "var(--text-2)", "margin-top": "2px" }}>
              {n.reason === "done" ? "Session finished" : "Asking a question"}
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
