import { describe, it, expect } from "vitest";
import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";

describe("buildDefaultRegistry", () => {
  it("returns a registry with query_project registered", () => {
    const reg = buildDefaultRegistry();
    expect(reg.has("query_project")).toBe(true);
  });

  it("builds a fresh registry each call (no shared mutable state)", () => {
    const a = buildDefaultRegistry();
    const b = buildDefaultRegistry();
    expect(a).not.toBe(b);
    // both have the same tool, but they are independent registries
    expect(a.list().length).toBe(b.list().length);
  });

  it("emits Anthropic-shape tool definitions", () => {
    const reg = buildDefaultRegistry();
    const defs = reg.toAnthropicTools();
    const queryDef = defs.find((d) => d.name === "query_project");
    expect(queryDef).toBeDefined();
    expect(queryDef?.input_schema).toBeDefined();
  });
});
