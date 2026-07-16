/**
 * Phase 42 (P0.3) — prompt-cache breakpoint placement.
 *
 * The API renders tools → system → messages. The old last-TOOL marker
 * therefore cached tools ONLY; the ~1.7K-token system prompt and the
 * entire message history were re-billed on every loop iteration (up to
 * 8 per user turn) — the single largest recoverable spend in the app.
 *
 * New contract:
 *  - system is a block array whose last block carries cache_control
 *    (a system breakpoint covers the tools+system prefix; the tool
 *    marker is gone — redundant and burning a breakpoint slot)
 *  - each iteration marks the LAST content block of the LAST message
 *    (rolling breakpoint: call N+1 reads call N's prefix)
 *  - stale markers are stripped from the snapshot so requests never
 *    accumulate toward the 4-breakpoint limit
 */
import { describe, it, expect, vi } from "vitest";
import {
  ToolRegistry,
  runToolUseLoop,
  withRollingCacheMarker,
  type AnthropicMessage,
  type AnthropicMessageParams,
  type AnthropicMessageResponse,
  type ContentBlock,
  type ToolContext,
} from "./overseer-tools";
import type { PrismaClient } from "@/app/generated/prisma/client";

function ctx(): ToolContext {
  return { prisma: {} as PrismaClient, sessionId: "s1" };
}

function response(
  content: AnthropicMessageResponse["content"],
  stopReason: string
): AnthropicMessageResponse {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-sonnet-4-6",
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register({
    name: "alpha",
    description: "a",
    inputSchema: { type: "object" },
    handler: async () => ({ ok: true }),
  });
  return reg;
}

function countMarkers(params: AnthropicMessageParams): number {
  let count = 0;
  if (Array.isArray(params.system)) {
    for (const block of params.system) {
      if (block.cache_control) count++;
    }
  }
  for (const tool of params.tools) {
    if (tool.cache_control) count++;
  }
  for (const msg of params.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("cache_control" in block && block.cache_control) count++;
      }
    }
  }
  return count;
}

describe("cache breakpoint placement (P0.3)", () => {
  it("caches the system prefix, not the tools", async () => {
    const seen: AnthropicMessageParams[] = [];
    await runToolUseLoop({
      caller: async (params) => {
        seen.push(params);
        return response([{ type: "text", text: "done" }], "end_turn");
      },
      model: "claude-sonnet-4-6",
      systemPrompt: "you are the overseer",
      messages: [{ role: "user", content: "go" }],
      registry: makeRegistry(),
      ctx: ctx(),
    });

    expect(seen.length).toBe(1);
    // System is a block array whose last block carries the marker
    const system = seen[0].system;
    expect(Array.isArray(system)).toBe(true);
    const blocks = system as Array<{ text: string; cache_control?: unknown }>;
    expect(blocks[blocks.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });
    expect(blocks.map((b) => b.text).join("")).toBe("you are the overseer");
    // Tools carry NO marker (system breakpoint already covers them)
    for (const tool of seen[0].tools) {
      expect(tool.cache_control).toBeUndefined();
    }
  });

  it("rolls a single message breakpoint forward across iterations", async () => {
    const seen: AnthropicMessageParams[] = [];
    let call = 0;
    await runToolUseLoop({
      caller: async (params) => {
        seen.push(params);
        call++;
        if (call === 1) {
          return response(
            [{ type: "tool_use", id: "t1", name: "alpha", input: {} }],
            "tool_use"
          );
        }
        return response([{ type: "text", text: "done" }], "end_turn");
      },
      model: "claude-sonnet-4-6",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "go" }],
      registry: makeRegistry(),
      ctx: ctx(),
    });

    expect(seen.length).toBe(2);

    // Call 1: the sole user message's last block carries the marker
    const call1Last = seen[0].messages[seen[0].messages.length - 1];
    const call1Blocks = call1Last.content as ContentBlock[];
    expect(Array.isArray(call1Blocks)).toBe(true);
    expect(
      (call1Blocks[call1Blocks.length - 1] as { cache_control?: unknown })
        .cache_control
    ).toEqual({ type: "ephemeral" });

    // Call 2: marker moved to the new last message (the tool_result);
    // exactly ONE message marker in the whole snapshot (stale stripped),
    // plus the system marker = 2 total.
    const call2Msgs = seen[1].messages;
    const last = call2Msgs[call2Msgs.length - 1];
    const lastBlocks = last.content as ContentBlock[];
    expect(lastBlocks[lastBlocks.length - 1].type).toBe("tool_result");
    expect(
      (lastBlocks[lastBlocks.length - 1] as { cache_control?: unknown })
        .cache_control
    ).toEqual({ type: "ephemeral" });
    let messageMarkers = 0;
    for (const msg of call2Msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if ((block as { cache_control?: unknown }).cache_control) {
          messageMarkers++;
        }
      }
    }
    expect(messageMarkers).toBe(1);
    expect(countMarkers(seen[1])).toBe(2); // system + rolling message
  });

  it("withRollingCacheMarker strips stale markers and never mutates input", () => {
    const original: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "compressed summary",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
      { role: "assistant", content: "ack" },
      { role: "user", content: "next question" },
    ];
    const marked = withRollingCacheMarker(original);

    // Stale marker on the summary block is gone in the snapshot
    const summaryBlock = (marked[0].content as ContentBlock[])[0] as {
      cache_control?: unknown;
    };
    expect(summaryBlock.cache_control).toBeUndefined();
    // Last message (string content) became a marked text block
    const lastBlocks = marked[2].content as ContentBlock[];
    expect(lastBlocks).toEqual([
      {
        type: "text",
        text: "next question",
        cache_control: { type: "ephemeral" },
      },
    ]);
    // Input untouched
    expect(
      (original[0].content as ContentBlock[])[0]
    ).toHaveProperty("cache_control");
    expect(typeof original[2].content).toBe("string");
  });

  it("leaves an empty-string terminal message unmarked (API rejects empty text blocks)", () => {
    const marked = withRollingCacheMarker([{ role: "user", content: "" }]);
    expect(marked[0].content).toBe("");
  });
});

// keep vi import referenced (registry handler uses no spies here)
void vi;
