import { Component, Show, createEffect, onCleanup } from "solid-js";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  createEffect(() => {
    if (!props.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); props.onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); props.onConfirm(); }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  return (
    <Show when={props.open}>
      <div onClick={props.onCancel} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "grid", "place-items": "center", "z-index": 200,
      }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          "border-radius": "8px",
          padding: "18px 20px",
          "min-width": "340px",
          "max-width": "480px",
        }}>
          <h3 style={{ margin: "0 0 8px", "font-size": "13px", color: "var(--text-1)" }}>{props.title}</h3>
          <div style={{ "font-size": "12px", color: "var(--text-2)", "white-space": "pre-wrap", "line-height": 1.5 }}>{props.body}</div>
          <div style={{ "margin-top": "16px", display: "flex", "justify-content": "flex-end", gap: "8px" }}>
            <button
              onClick={props.onCancel}
              style={{
                "font-size": "11px",
                padding: "5px 12px",
                background: "var(--bg-2)",
                color: "var(--text-1)",
                border: "1px solid var(--border)",
                "border-radius": "4px",
                cursor: "pointer",
              }}
            >
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={props.onConfirm}
              style={{
                "font-size": "11px",
                padding: "5px 12px",
                background: props.danger ? "#7f1d1d" : "var(--accent-bg)",
                color: props.danger ? "#fecaca" : "var(--text-1)",
                border: `1px solid ${props.danger ? "#991b1b" : "var(--border)"}`,
                "border-radius": "4px",
                cursor: "pointer",
                "font-weight": "bold",
              }}
            >
              {props.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
