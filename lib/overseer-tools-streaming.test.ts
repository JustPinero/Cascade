/**
 * Phase 25.2 — streaming caller tests.
 *
 * Uses a fixture SSE stream piped through a real Response body
 * (no mocks of fetch internals) so the SSE-frame parsing is
 * exercised end-to-end.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import {
  defaultStreamingAnthropicCaller,
  pipeSseEvents,
} from "./overseer-tools-streaming";
import type { StreamEvent } from "./streaming-accumulator";

afterEach(() => {
  vi.restoreAllMocks();
});

function sseFrame(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeSseStream(events: { name: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(sseFrame(e.name, e.data)));
      controller.close();
    },
  });
}

const TEXT_STREAM_FIXTURE = [
  {
    name: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-6",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    },
  },
  {
    name: "content_block_start",
    data: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  },
  {
    name: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    },
  },
  {
    name: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: ", world" },
    },
  },
  {
    name: "content_block_stop",
    data: { type: "content_block_stop", index: 0 },
  },
  {
    name: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: {
        output_tokens: 25,
        cache_read_input_tokens: 5000,
      },
    },
  },
  { name: "message_stop", data: { type: "message_stop" } },
];

describe("pipeSseEvents", () => {
  it("parses an SSE stream and forwards each event to the sink", async () => {
    const events: StreamEvent[] = [];
    await pipeSseEvents(makeSseStream(TEXT_STREAM_FIXTURE), (e) => events.push(e));
    expect(events).toHaveLength(TEXT_STREAM_FIXTURE.length);
    expect(events[0].type).toBe("message_start");
    expect(events[events.length - 1].type).toBe("message_stop");
  });

  it("handles SSE frames split across chunks", async () => {
    const events: StreamEvent[] = [];
    const enc = new TextEncoder();
    const fullText = TEXT_STREAM_FIXTURE.map((e) => sseFrame(e.name, e.data)).join("");
    // Split mid-frame to exercise the buffer/boundary handling
    const split = Math.floor(fullText.length / 2) + 5;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(fullText.slice(0, split)));
        controller.enqueue(enc.encode(fullText.slice(split)));
        controller.close();
      },
    });
    await pipeSseEvents(stream, (e) => events.push(e));
    expect(events).toHaveLength(TEXT_STREAM_FIXTURE.length);
  });

  it("ignores [DONE] sentinel and unparseable data lines", async () => {
    const events: StreamEvent[] = [];
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("event: message_stop\ndata: [DONE]\n\n"));
        controller.enqueue(enc.encode("event: weird\ndata: not-json\n\n"));
        controller.close();
      },
    });
    await pipeSseEvents(stream, (e) => events.push(e));
    expect(events).toHaveLength(0);
  });
});

describe("defaultStreamingAnthropicCaller", () => {
  it("requests stream:true and assembles the buffered response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
      // confirm body has stream: true
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.stream).toBe(true);
      return new Response(makeSseStream(TEXT_STREAM_FIXTURE), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const caller = defaultStreamingAnthropicCaller({ apiKey: "sk-test" });
    const result = await caller(
      {
        model: "claude-sonnet-4-6",
        system: "x",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      },
      {}
    );
    expect(result.id).toBe("msg_test");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "Hello, world" });
    expect(result.usage.cache_read_input_tokens).toBe(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards each SSE event to onEvent in arrival order", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(makeSseStream(TEXT_STREAM_FIXTURE), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const seen: StreamEvent[] = [];
    const caller = defaultStreamingAnthropicCaller({
      apiKey: "sk-test",
      onEvent: (e) => seen.push(e),
    });
    await caller(
      {
        model: "claude-sonnet-4-6",
        system: "x",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      },
      {}
    );
    expect(seen.map((e) => e.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("does not poison the stream when onEvent throws", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(makeSseStream(TEXT_STREAM_FIXTURE), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const caller = defaultStreamingAnthropicCaller({
      apiKey: "sk-test",
      onEvent: () => {
        throw new Error("buggy handler");
      },
    });
    const result = await caller(
      {
        model: "claude-sonnet-4-6",
        system: "x",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      },
      {}
    );
    // Stream still completes despite the throwing handler
    expect(result.id).toBe("msg_test");
  });

  it("throws on non-200 with the body text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("rate limited", { status: 429 });
    });
    const caller = defaultStreamingAnthropicCaller({ apiKey: "sk-test" });
    await expect(
      caller(
        {
          model: "claude-sonnet-4-6",
          system: "x",
          messages: [],
          tools: [],
        },
        {}
      )
    ).rejects.toThrow(/429/);
  });
});
