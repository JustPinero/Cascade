/**
 * Phase 25.2 — streaming Anthropic caller.
 *
 * Mirrors `defaultAnthropicCaller` but reads the response as a
 * Server-Sent Events stream. Forwards each event to `onEvent` so
 * route handlers can stream text deltas to clients in real time,
 * then resolves with the assembled `AnthropicMessageResponse` so
 * the existing tool-use loop body works unchanged.
 *
 * Usage telemetry comes from the final `message_delta` event's
 * usage payload (NOT the `message_start` envelope, which doesn't
 * include cache fields).
 */
import type {
  AnthropicCaller,
  AnthropicMessageResponse,
} from "@/lib/overseer-tools";
import {
  applyStreamEvent,
  assembleResponse,
  createStreamAccumulator,
  type StreamEvent,
} from "@/lib/streaming-accumulator";

export type StreamingAnthropicCaller = (
  ...args: Parameters<AnthropicCaller>
) => Promise<AnthropicMessageResponse>;

interface StreamingCallerOptions {
  apiKey: string;
  /** Forwarded synchronously each time an SSE event arrives. */
  onEvent?: (event: StreamEvent) => void;
}

/**
 * Returns an AnthropicCaller-compatible function that requests the
 * streaming variant of the Messages API. Forwards every parsed SSE
 * event to `onEvent` and resolves with the assembled response when
 * `message_stop` arrives.
 */
export function defaultStreamingAnthropicCaller(
  opts: StreamingCallerOptions
): AnthropicCaller {
  return async (params, callOptions) => {
    const start = performance.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ ...params, stream: true }),
      signal: callOptions?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${text}`);
    }
    if (!response.body) {
      throw new Error("Anthropic streaming response had no body");
    }

    const state = createStreamAccumulator();

    await pipeSseEvents(response.body, (event) => {
      applyStreamEvent(state, event);
      try {
        opts.onEvent?.(event);
      } catch {
        // onEvent handlers must not poison the stream
      }
    });

    const assembled = assembleResponse(state);

    // Phase 23.3-style usage telemetry, now sourced from message_delta.
    const { logUsage } = await import("./anthropic-usage-log");
    const { prisma } = await import("./db");
    logUsage(prisma, {
      callSite: "overseer.chat",
      model: params.model,
      usage: assembled.usage as unknown as Parameters<
        typeof logUsage
      >[1]["usage"],
      durationMs: Math.round(performance.now() - start),
    });

    return assembled;
  };
}

/**
 * Pipe an SSE response body, parse events, and forward to a sink.
 * Exported so `/api/wizard/chat` and `/api/projects/[slug]/chat` can
 * tap their own (already-streaming) responses and call logUsage when
 * `message_delta` arrives — closing 23.D3.
 */
export async function pipeSseEvents(
  body: ReadableStream<Uint8Array>,
  sink: (event: StreamEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by \n\n
      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = parseSseFrame(frame);
        if (event) sink(event);
        frameEnd = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseFrame(frame: string): StreamEvent | null {
  let data: string | null = null;
  for (const line of frame.split("\n")) {
    if (line.startsWith("data: ")) {
      data = line.slice("data: ".length);
    }
  }
  if (!data) return null;
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}
