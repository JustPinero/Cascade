/**
 * Phase 25.1 — adaptive thinking round-trip tests.
 *
 * Sonnet 4.6's adaptive thinking may emit ThinkingBlock entries
 * alongside text + tool_use in assistant turns. The loop must
 * preserve them verbatim across tool-use → tool-result → next
 * request, or the API 400s on signature mismatch.
 */
import { vi, describe, it, expect } from "vitest";
import {
  runToolUseLoop,
  ToolRegistry,
  type AnthropicCaller,
  type AnthropicMessageResponse,
  type ContentBlock,
  type ThinkingBlock,
  type Tool,
} from "./overseer-tools";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

function makeTool(name: string): Tool {
  return {
    name,
    description: "test",
    inputSchema: { type: "object" },
    handler: async () => ({ ok: 1 }),
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

const TEXT_FINAL: AnthropicMessageResponse = {
  id: "msg-final",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "done" }],
  model: "claude-sonnet-4-6",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

describe("thinking block round-trip", () => {
  it("preserves a thinking block on an intermediate tool-use turn", async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("alpha"));

    const thinkingTurn: AnthropicMessageResponse = {
      id: "msg-1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "reasoning about the call",
          signature: "OPAQUE_SIG_DO_NOT_MUTATE",
        } as ThinkingBlock,
        {
          type: "tool_use",
          id: "toolu_1",
          name: "alpha",
          input: {},
        },
      ],
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    const caller = chainCaller([thinkingTurn, TEXT_FINAL]);
    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "go" }],
      registry: reg,
      ctx: { prisma: {} as never },
    });

    // Find the assistant turn that came back from the model — it
    // must include the thinking block verbatim, including signature.
    const assistantTurn = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        (m.content as ContentBlock[]).some((b) => b.type === "thinking")
    );
    expect(assistantTurn).toBeDefined();
    const blocks = assistantTurn!.content as ContentBlock[];
    const thinking = blocks.find(
      (b): b is ThinkingBlock => b.type === "thinking"
    );
    expect(thinking).toBeDefined();
    expect(thinking!.thinking).toBe("reasoning about the call");
    expect(thinking!.signature).toBe("OPAQUE_SIG_DO_NOT_MUTATE");
  });

  it("extractTextBlocks ignores thinking blocks", async () => {
    const reg = new ToolRegistry();

    const finalWithThinking: AnthropicMessageResponse = {
      id: "msg-final",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "internal",
          signature: "sig",
        } as ThinkingBlock,
        { type: "text", text: "answer" },
      ],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    const caller = chainCaller([finalWithThinking]);
    const result = await runToolUseLoop({
      caller,
      model: "claude-sonnet-4-6",
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      registry: reg,
      ctx: { prisma: {} as never },
    });

    // Final text concatenation only includes text blocks — thinking
    // is filtered out cleanly.
    expect(result.finalText).toBe("answer");
    expect(result.finalText).not.toContain("internal");
  });
});
