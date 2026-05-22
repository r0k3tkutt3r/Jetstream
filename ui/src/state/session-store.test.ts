import { describe, expect, it } from "vitest";
import { createSessionStore } from "./session-store";

describe("session store", () => {
  it("appends assistant deltas onto the same message", () => {
    const s = createSessionStore({ id: "a", name: "n", cwd: "/", mode: "bypassPermissions" });
    s.handleEvent({ type: "Assistant", msg_id: "m1", delta: "Hel" });
    s.handleEvent({ type: "Assistant", msg_id: "m1", delta: "lo" });
    const msgs = s.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toBe("Hello");
  });

  it("a new msg_id starts a new message", () => {
    const s = createSessionStore({ id: "a", name: "n", cwd: "/", mode: "bypassPermissions" });
    s.handleEvent({ type: "Assistant", msg_id: "m1", delta: "Hi" });
    s.handleEvent({ type: "Assistant", msg_id: "m2", delta: "Yo" });
    expect(s.messages()).toHaveLength(2);
  });

  it("Tool event attaches to the current assistant message", () => {
    const s = createSessionStore({ id: "a", name: "n", cwd: "/", mode: "bypassPermissions" });
    s.handleEvent({ type: "Assistant", msg_id: "m1", delta: "thinking" });
    s.handleEvent({ type: "Tool", id: "t1", name: "Read", input: { file: "x" } });
    const last = s.messages()[s.messages().length - 1];
    expect(last.tools).toHaveLength(1);
    expect(last.tools![0].name).toBe("Read");
  });

  it("SubagentStart / Stop project into subagents map", () => {
    const s = createSessionStore({ id: "a", name: "n", cwd: "/", mode: "bypassPermissions" });
    s.handleEvent({ type: "SubagentStart", id: "sa1", agent: "explore", prompt: "p" });
    expect(Object.keys(s.subagents()).length).toBe(1);
    s.handleEvent({ type: "SubagentStop", id: "sa1", result: { ok: true } });
    expect(s.subagents()["sa1"].completed).toBe(true);
  });

  it("user message appended on sendUserMessage", () => {
    const s = createSessionStore({ id: "a", name: "n", cwd: "/", mode: "bypassPermissions" });
    s.appendUserMessage("write a test");
    expect(s.messages()[0].role).toBe("user");
    expect(s.messages()[0].content).toBe("write a test");
  });
});
