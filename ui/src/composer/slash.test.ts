import { describe, expect, it } from "vitest";
import { matchSlash } from "./SlashPalette";

const cmds = [
  { name: "agents",  description: "manage",       argument_hint: null },
  { name: "clear",   description: "wipe",         argument_hint: null },
  { name: "compact", description: "summarize",    argument_hint: null },
  { name: "model",   description: "switch model", argument_hint: "<model>" },
];

describe("slash matcher", () => {
  it("returns all when empty query", () => {
    expect(matchSlash("", cmds).length).toBe(4);
  });
  it("prefix match wins", () => {
    const out = matchSlash("ag", cmds);
    expect(out[0].name).toBe("agents");
  });
  it("fuzzy match against name", () => {
    const out = matchSlash("cmp", cmds);
    expect(out.some((c) => c.name === "compact")).toBe(true);
  });
  it("no match returns empty", () => {
    expect(matchSlash("zzz", cmds)).toEqual([]);
  });
});
