/**
 * Phase 24.2 — runToolUseLoop instrumentation test.
 *
 * Asserts that registry.execute calls produce ToolCallEvent rows
 * via the fire-and-forget queueMicrotask path.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import {
  runToolUseLoop,
  ToolRegistry,
  type AnthropicCaller,
  type AnthropicMessageResponse,
  type Tool,
} from "./overseer-tools";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 500));
}

function makeTool(opts: {
  name: string;
  fail?: boolean;
}): Tool {
  return {
    name: opts.name,
    description: "test tool",
    inputSchema: { type: "object" },
    handler: async () => {
      if (opts.fail) throw new Error("simulated tool failure");
      return { ok: 1 };
    },
  };
}

function chainCaller(responses: AnthropicMessageResponse[]): AnthropicCaller {
  let i = 0;
  return async () => {
    const r = responses[i];
    i = Math.min(i + 1, responses.length - 1);
    return r;
  };
}

const TEXT_TURN: AnthropicMessageResponse = {
  id: "msg-final",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "done" }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

function toolUseTurn(name: string, id = "toolu_1"): AnthropicMessageResponse {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id, name, input: { foo: "bar" } }],
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe("runToolUseLoop — tool-call telemetry", () => {
  it("writes one ToolCallEvent row per tool execution", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "alpha" }));

    const caller = chainCaller([toolUseTurn("alpha"), TEXT_TURN]);
    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: { prisma: rig.prisma, sessionId: "test-session" },
    });

    await flushMicrotasks();
    const rows = await rig.prisma.toolCallEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: "test-session",
      toolName: "alpha",
      success: true,
      iteration: 0,
    });
    expect(rows[0].outputSize).toBeGreaterThan(0);
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records success: false when the handler throws", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "boom", fail: true }));

    const caller = chainCaller([toolUseTurn("boom"), TEXT_TURN]);
    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: { prisma: rig.prisma, sessionId: "test-session" },
    });

    await flushMicrotasks();
    const rows = await rig.prisma.toolCallEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(false);
    expect(rows[0].errorMessage).toMatch(/simulated tool failure/);
  });

  it("does not write rows when ctx.sessionId is absent", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const reg = new ToolRegistry();
    reg.register(makeTool({ name: "alpha" }));

    const caller = chainCaller([toolUseTurn("alpha"), TEXT_TURN]);
    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: { prisma: rig.prisma }, // no sessionId
    });

    await flushMicrotasks();
    const rows = await rig.prisma.toolCallEvent.findMany();
    expect(rows).toHaveLength(0);
  });

  it("truncates oversized inputs to 4 KB", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const reg = new ToolRegistry();
    reg.register({
      name: "big",
      description: "",
      inputSchema: { type: "object" },
      handler: async () => "ok",
    });

    const bigInput = { huge: "x".repeat(8000) };
    const caller = chainCaller([
      {
        ...toolUseTurn("big"),
        content: [{ type: "tool_use", id: "tu", name: "big", input: bigInput }],
      },
      TEXT_TURN,
    ]);
    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: { prisma: rig.prisma, sessionId: "trunc-session" },
    });

    await flushMicrotasks();
    const rows = await rig.prisma.toolCallEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].input.length).toBeLessThanOrEqual(4096);
  });
});
