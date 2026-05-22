import { Component } from "solid-js";

export const App: Component = () => {
  return (
    <div style={{ height: "100%", display: "grid", "place-items": "center" }}>
      <div style={{ "text-align": "center" }}>
        <h1 style={{ "font-weight": 500, margin: 0 }}>CCShell</h1>
        <p style={{ color: "var(--text-3)", "margin-top": "0.4em" }}>v0.1.0</p>
      </div>
    </div>
  );
};
