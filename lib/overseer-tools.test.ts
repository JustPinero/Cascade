import { describe, it, expect } from "vitest";
import { ToolRegistry, type Tool, type ToolContext } from "@/lib/overseer-tools";

function makeCtx(): ToolContext {
  // For unit tests we don't actually exercise prisma — cast through unknown.
  return { prisma: {} as ToolContext["prisma"] };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: overrides.name ?? "test_tool",
    description: overrides.description ?? "a test tool",
    inputSchema: overrides.inputSchema ?? {
      type: "object",
      properties: { x: { type: "string" } },
    },
    handler:
      overrides.handler ??
      (async (input: unknown) => ({ echoed: input })),
  };
}

describe("ToolRegistry", () => {
  it("registers a tool and looks it up by name", () => {
    const reg = new ToolRegistry();
    const tool = makeTool({ name: "alpha" });
    reg.register(tool);
    expect(reg.has("alpha")).toBe(true);
    expect(reg.get("alpha")).toBe(tool);
    expect(reg.get("missing")).toBeUndefined();
  });

  it("throws on duplicate name", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "dup" }));
    expect(() => reg.register(makeTool({ name: "dup" }))).toThrow(/dup/);
  });

  it("lists all registered tools", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "a" }));
    reg.register(makeTool({ name: "b" }));
    const names = reg.list().map((t) => t.name);
    expect(names).toEqual(["a", "b"]);
  });

  it("converts to Anthropic tool shape", () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: "query_project",
        description: "Get current state for a project.",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"],
        },
      })
    );
    const result = reg.toAnthropicTools();
    // Phase 23.4 — last tool gets cache_control for prompt caching.
    expect(result).toEqual([
      {
        name: "query_project",
        description: "Get current state for a project.",
        input_schema: {
          type: "object",
          properties: { slug: { type: "string" } },
          required: ["slug"],
        },
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("only the last tool carries cache_control when multiple tools are registered", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "first", description: "first" }));
    reg.register(makeTool({ name: "second", description: "second" }));
    reg.register(makeTool({ name: "third", description: "third" }));
    const result = reg.toAnthropicTools();
    expect(result[0].cache_control).toBeUndefined();
    expect(result[1].cache_control).toBeUndefined();
    expect(result[2].cache_control).toEqual({ type: "ephemeral" });
  });

  it("empty registry returns an empty array without throwing", () => {
    const reg = new ToolRegistry();
    expect(reg.toAnthropicTools()).toEqual([]);
  });
});

describe("ToolRegistry.execute", () => {
  it("invokes the handler and wraps the output in {ok: true, output}", async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: "echo",
        handler: async (input: unknown) => ({ got: input }),
      })
    );
    const result = await reg.execute("echo", { foo: "bar" }, makeCtx());
    expect(result).toEqual({ ok: true, output: { got: { foo: "bar" } } });
  });

  it("returns {ok: false, error} on unknown tool", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("missing", {}, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing/i);
    }
  });

  it("catches handler errors and returns {ok: false, error}", async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool({
        name: "boom",
        handler: async () => {
          throw new Error("kaboom");
        },
      })
    );
    const result = await reg.execute("boom", {}, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("kaboom");
    }
  });

  it("passes input through to the handler verbatim", async () => {
    const reg = new ToolRegistry();
    let received: unknown = null;
    reg.register(
      makeTool({
        name: "capture",
        handler: async (input: unknown) => {
          received = input;
          return null;
        },
      })
    );
    const payload = { a: 1, nested: { b: [2, 3] } };
    await reg.execute("capture", payload, makeCtx());
    expect(received).toEqual(payload);
  });

  it("passes ctx to the handler", async () => {
    const reg = new ToolRegistry();
    let receivedCtx: ToolContext | null = null;
    reg.register(
      makeTool({
        name: "ctx",
        handler: async (_input, ctx) => {
          receivedCtx = ctx;
          return null;
        },
      })
    );
    const ctx: ToolContext = { ...makeCtx(), sessionId: "sess-1" };
    await reg.execute("ctx", {}, ctx);
    expect(receivedCtx).toBe(ctx);
  });
});
