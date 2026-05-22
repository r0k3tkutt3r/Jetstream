import { describe, expect, it, vi } from "vitest";

// Mock the tauri invoke before importing the bridge
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, _args?: unknown) => {
    if (cmd === "list_agents") return [{ name: "x", description: "y" }];
    if (cmd === "caffeinate_status") return { active: false, refcount: 0 };
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { ipc } from "./bridge";

describe("ipc bridge", () => {
  it("listAgents passes through invoke result", async () => {
    const r = await ipc.listAgents();
    expect(r).toEqual([{ name: "x", description: "y" }]);
  });
  it("caffeinateStatus returns refcount", async () => {
    const r = await ipc.caffeinateStatus();
    expect(r.refcount).toBe(0);
  });
});
