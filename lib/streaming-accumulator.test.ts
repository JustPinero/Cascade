/**
 * Phase 25.2 — accumulator tests.
 */
import { describe, it, expect } from "vitest";
import {
  createStreamAccumulator,
  applyStreamEvent,
  assembleResponse,
  type StreamEvent,
} from "./streaming-accumulator";

function feed(events: StreamEvent[]) {
  const state = createStreamAccumulator();
  for (const e of events) applyStreamEvent(state, e);
  return assembleResponse(state);
}

describe("streaming accumulator", () => {
  it("assembles a plain text response", () => {
    const out = feed([
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-6",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: ", world" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 10 },
      },
      { type: "message_stop" },
    ]);

    expect(out.id).toBe("msg_1");
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage.input_tokens).toBe(100);
    expect(out.usage.output_tokens).toBe(10);
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({ type: "text", text: "Hello, world" });
  });

  it("assembles a tool_use block from streamed input_json_delta", () => {
    const out = feed([
      {
        type: "message_start",
        message: {
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-6",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "query_project",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"slu' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'g":"medipal"}' },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
      },
      { type: "message_stop" },
    ]);

    expect(out.content).toHaveLength(1);
    const block = out.content[0];
    expect(block.type).toBe("tool_use");
    if (block.type === "tool_use") {
      expect(block.name).toBe("query_project");
      expect(block.input).toEqual({ slug: "medipal" });
    }
  });

  it("interleaves text and tool_use blocks at distinct indices", () => {
    const out = feed([
      {
        type: "message_start",
        message: {
          id: "msg_3",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-6",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Looking up..." },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_x",
          name: "alpha",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
      },
      { type: "message_stop" },
    ]);

    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: "text", text: "Looking up..." });
    expect(out.content[1].type).toBe("tool_use");
  });

  it("accumulates thinking blocks with signature_delta", () => {
    const out = feed([
      {
        type: "message_start",
        message: {
          id: "msg_4",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-6",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me consider..." },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "OPAQUE_SIG" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
      },
      { type: "message_stop" },
    ]);

    expect(out.content[0]).toEqual({
      type: "thinking",
      thinking: "Let me consider...",
      signature: "OPAQUE_SIG",
    });
  });

  it("throws on malformed input_json_delta at content_block_stop", () => {
    const state = createStreamAccumulator();
    applyStreamEvent(state, {
      type: "message_start",
      message: {
        id: "x",
        type: "message",
        role: "assistant",
        content: [],
        model: "m",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    applyStreamEvent(state, {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tu",
        name: "alpha",
        input: {},
      },
    });
    applyStreamEvent(state, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{not" },
    });
    applyStreamEvent(state, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: " json" },
    });
    expect(() =>
      applyStreamEvent(state, { type: "content_block_stop", index: 0 })
    ).toThrow(/did not parse/);
  });

  it("captures usage from message_delta", () => {
    const out = feed([
      {
        type: "message_start",
        message: {
          id: "msg_5",
          type: "message",
          role: "assistant",
          content: [],
          model: "m",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens: 250,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 1000,
        },
      },
      { type: "message_stop" },
    ]);

    expect(out.usage.input_tokens).toBe(100);
    expect(out.usage.output_tokens).toBe(250);
    expect(out.usage.cache_read_input_tokens).toBe(5000);
    expect(out.usage.cache_creation_input_tokens).toBe(1000);
  });
});
