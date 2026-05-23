import { Component } from "solid-js";
import "../styles/panes.css";
import { LeftPane, type LeftPaneProps } from "./LeftPane";
import { CenterPane, type CenterPaneProps } from "./CenterPane";
import { RightPane, type RightPaneProps } from "./RightPane";

export interface LayoutProps {
  left: LeftPaneProps;
  center: CenterPaneProps;
  right: RightPaneProps;
  showLeft: boolean;
  showRight: boolean;
}

export const Layout: Component<LayoutProps> = (props) => (
  <div class="app-shell">
    <div class="titlebar" data-tauri-drag-region />
    <div classList={{ layout: true, "no-left": !props.showLeft, "no-right": !props.showRight }}>
      {props.showLeft  && <LeftPane  {...props.left} />}
      <CenterPane {...props.center} />
      {props.showRight && <RightPane {...props.right} />}
    </div>
  </div>
);
