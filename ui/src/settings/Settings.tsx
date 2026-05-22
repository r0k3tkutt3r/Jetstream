import { Component, createSignal, Show } from "solid-js";

export interface SettingsProps {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  onSetTheme: (t: "dark" | "light") => void;
  fontFamily: string;
  onSetFontFamily: (f: string) => void;
  fontSize: number;
  onSetFontSize: (n: number) => void;
}

export const Settings: Component<SettingsProps> = (props) => {
  const [fontInput, setFontInput] = createSignal(props.fontFamily);

  return (
    <Show when={props.open}>
      <div onClick={props.onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "grid", "place-items": "center", "z-index": 100,
      }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          "border-radius": "8px",
          padding: "20px",
          "min-width": "320px",
        }}>
          <h3 style={{ margin: "0 0 12px", "font-size": "14px" }}>Settings</h3>
          <div style={{ display: "grid", "grid-template-columns": "120px 1fr", gap: "8px", "font-size": "12px" }}>
            <label>Theme</label>
            <select value={props.theme} onChange={(e) => props.onSetTheme(e.currentTarget.value as "dark" | "light")}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <label>Font family</label>
            <input value={fontInput()} onInput={(e) => setFontInput(e.currentTarget.value)} onBlur={() => props.onSetFontFamily(fontInput())} />
            <label>Font size</label>
            <input type="number" min="10" max="20" value={props.fontSize} onInput={(e) => props.onSetFontSize(Number(e.currentTarget.value))} />
          </div>
          <div style={{ "margin-top": "16px", "text-align": "right" }}>
            <button onClick={props.onClose}>Close</button>
          </div>
        </div>
      </div>
    </Show>
  );
};
