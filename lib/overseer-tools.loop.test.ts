import { describe, it, expect, vi } from "vitest";
import {
  ToolRegistry,
  runToolUseLoop,
  type AnthropicCaller,
  type AnthropicMessageParams,
  type AnthropicMessageResponse,
  type ToolContext,
} from "@/lib/overseer-tools";

function ctx(): ToolContext {
  return { prisma: {} as ToolContext["prisma"] };
}

/**
 * Build a mock caller from a list of canned responses. Each call to
 * the caller returns the next response in the sequence; throws if the
 * sequence runs out (catches accidental extra round-trips).
 */
function mockCaller(
  responses: AnthropicMessageResponse[],
  options: { onCall?: (params: AnthropicMessageParams) => void } = {}
): AnthropicCaller {
  let i = 0;
  return async (params) => {
    options.onCall?.(params);
    if (i >= responses.length) {
      throw new Error(`mockCaller exhausted at call #${i + 1}`);
    }
    return responses[i++];
  };
}

function textResponse(text: string): AnthropicMessageResponse {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function toolUseResponse(
  blocks: Array<{ id: string; name: string; input: Record<string, unknown> }>
): AnthropicMessageResponse {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: blocks.map((b) => ({
      type: "tool_use" as const,
      id: b.id,
      name: b.name,
      input: b.input,
    })),
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe("runToolUseLoop", () => {
  it("returns finalText when the first response has no tool_use blocks", async () => {
    const reg = new ToolRegistry();
    const caller = mockCaller([textResponse("hello world")]);

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "you are a test",
      messages: [{ role: "user", content: "hi" }],
      registry: reg,
      ctx: ctx(),
    });

    expect(result.finalText).toBe("hello world");
    expect(result.toolCallsExecuted).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("executes tool_use blocks and continues the conversation", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "query_project",
      description: "Project state",
      inputSchema: { type: "object", properties: { slug: { type: "string" } } },
      handler: async (input: unknown) => {
        const { slug } = input as { slug: string };
        return { slug, health: "healthy" };
      },
    });

    const caller = mockCaller([
      toolUseResponse([{ id: "t1", name: "query_project", input: { slug: "cascade" } }]),
      textResponse("cascade is healthy"),
    ]);

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "how is cascade?" }],
      registry: reg,
      ctx: ctx(),
    });

    expect(result.finalText).toBe("cascade is healthy");
    expect(result.toolCallsExecuted).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("preserves the assistant message containing tool_use blocks in the message log", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "query_project",
      description: "x",
      inputSchema: {},
      handler: async () => ({ ok: true }),
    });

    const caller = mockCaller([
      toolUseResponse([{ id: "t1", name: "query_project", input: { slug: "x" } }]),
      textResponse("done"),
    ]);

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "test",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: ctx(),
    });

    // After the loop, messages should contain:
    //   [user "go", assistant <tool_use>, user <tool_result>, assistant "done"]
    expect(result.messages.length).toBe(4);
    expect(result.messages[0]).toEqual({ role: "user", content: "go" });
    expect(result.messages[1].role).toBe("assistant");
    const toolUseContent = result.messages[1].content;
    expect(Array.isArray(toolUseContent)).toBe(true);
    if (Array.isArray(toolUseContent)) {
      expect(toolUseContent[0]).toMatchObject({
        type: "tool_use",
        id: "t1",
        name: "query_project",
      });
    }
    expect(result.messages[2].role).toBe("user");
    const toolResultContent = result.messages[2].content;
    if (Array.isArray(toolResultContent)) {
      expect(toolResultContent[0]).toMatchObject({
        type: "tool_result",
        tool_use_id: "t1",
      });
    }
    expect(result.messages[3]).toEqual({ role: "assistant", content: "done" });
  });

  it("forwards tools to the caller every turn", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "alpha",
      description: "a",
      inputSchema: { type: "object" },
      handler: async () => null,
    });

    const seen: AnthropicMessageParams[] = [];
    const caller = mockCaller([textResponse("ok")], {
      onCall: (p) => seen.push(p),
    });

    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: ctx(),
    });

    expect(seen.length).toBe(1);
    expect(seen[0].tools).toEqual([
      {
        name: "alpha",
        description: "a",
        input_schema: { type: "object" },
      },
    ]);
  });

  it("returns tool errors as tool_result with is_error: true", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "boom",
      description: "fails",
      inputSchema: {},
      handler: async () => {
        throw new Error("kaboom");
      },
    });

    const captured: AnthropicMessageParams[] = [];
    const caller = mockCaller(
      [
        toolUseResponse([{ id: "t1", name: "boom", input: {} }]),
        textResponse("recovered"),
      ],
      { onCall: (p) => captured.push(p) }
    );

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: ctx(),
    });

    // Second call to the caller should include a tool_result message
    // with is_error: true and the error string.
    const secondCall = captured[1];
    const lastUserMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastUserMsg.role).toBe("user");
    if (Array.isArray(lastUserMsg.content)) {
      const block = lastUserMsg.content[0] as Record<string, unknown>;
      expect(block.type).toBe("tool_result");
      expect(block.tool_use_id).toBe("t1");
      expect(block.is_error).toBe(true);
      expect(block.content).toMatch(/kaboom/);
    }
    expect(result.toolCallsExecuted).toBe(1);
  });

  it("respects maxIterations and returns truncated: true when exceeded", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "loop_forever",
      description: "x",
      inputSchema: {},
      handler: async () => ({ keep: "going" }),
    });

    // Caller always returns tool_use, never text — would loop forever.
    const responses = Array.from({ length: 10 }, (_, i) =>
      toolUseResponse([{ id: `t${i}`, name: "loop_forever", input: {} }])
    );
    const caller = mockCaller(responses);

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: ctx(),
      maxIterations: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.toolCallsExecuted).toBe(3);
  });

  it("propagates a caller exception out of the loop without leaking partial state", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "alpha",
      description: "x",
      inputSchema: {},
      handler: async () => null,
    });

    const caller = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream 503: gateway timeout"));

    await expect(
      runToolUseLoop({
        caller: caller as unknown as AnthropicCaller,
        model: "claude-sonnet-4-6",
        systemPrompt: "x",
        messages: [{ role: "user", content: "go" }],
        registry: reg,
        ctx: ctx(),
      })
    ).rejects.toThrow(/upstream 503/);
  });

  it("propagates the abort signal to the caller", async () => {
    const reg = new ToolRegistry();
    const seenSignals: (AbortSignal | undefined)[] = [];
    const caller: AnthropicCaller = async (_p, options) => {
      seenSignals.push(options?.signal);
      return textResponse("ok");
    };

    const ac = new AbortController();
    await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      registry: reg,
      ctx: ctx(),
      signal: ac.signal,
    });

    expect(seenSignals.length).toBe(1);
    expect(seenSignals[0]).toBe(ac.signal);
  });

  it("returns truncated:true and stops looping when the signal is already aborted", async () => {
    const reg = new ToolRegistry();
    const caller = vi.fn();
    const ac = new AbortController();
    ac.abort();

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      registry: reg,
      ctx: ctx(),
      signal: ac.signal,
    });

    expect(result.truncated).toBe(true);
    expect(caller).not.toHaveBeenCalled();
  });

  it("handles parallel tool_use blocks in a single response", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "a",
      description: "x",
      inputSchema: {},
      handler: async () => ({ which: "a" }),
    });
    reg.register({
      name: "b",
      description: "x",
      inputSchema: {},
      handler: async () => ({ which: "b" }),
    });

    const captured: AnthropicMessageParams[] = [];
    const caller = mockCaller(
      [
        toolUseResponse([
          { id: "t1", name: "a", input: {} },
          { id: "t2", name: "b", input: {} },
        ]),
        textResponse("got both"),
      ],
      { onCall: (p) => captured.push(p) }
    );

    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: ctx(),
    });

    expect(result.toolCallsExecuted).toBe(2);

    // The user message returned to the model should contain BOTH
    // tool_results, in the same order.
    const second = captured[1];
    const lastMsg = second.messages[second.messages.length - 1];
    if (Array.isArray(lastMsg.content)) {
      expect(lastMsg.content.length).toBe(2);
      const r1 = lastMsg.content[0] as Record<string, unknown>;
      const r2 = lastMsg.content[1] as Record<string, unknown>;
      expect(r1.tool_use_id).toBe("t1");
      expect(r2.tool_use_id).toBe("t2");
    }
  });
});
