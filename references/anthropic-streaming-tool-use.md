# Streaming with Tool Use — Cascade reference

The Overseer chat path currently buffers the full Anthropic response, then replays it as SSE for the dashboard (`app/api/overseer/chat/route.ts:362`, `sseFromText` helper). This works but loses the latency benefit of streaming. Real streaming during tool-use loops is more involved than streaming a plain text response — this doc captures the event grammar and the accumulator pattern.

## SSE event grammar

Standard event order for a single Anthropic Messages API streamed response:

```
message_start
  content_block_start  (one per block — text, tool_use, thinking)
    content_block_delta (zero or more)
  content_block_stop
  ... more blocks ...
message_delta            (final usage and stop_reason)
message_stop
```

For a response with one text block and one tool_use block, you'd see:

```sse
event: message_start
data: { "type": "message_start", "message": { "id": "msg_...", "usage": {...} } }

event: content_block_start
data: { "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }

event: content_block_delta
data: { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Let me look up..." } }

event: content_block_stop
data: { "type": "content_block_stop", "index": 0 }

event: content_block_start
data: { "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "toolu_01...", "name": "query_project", "input": {} } }

event: content_block_delta
data: { "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"slu" } }

event: content_block_delta
data: { "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "g\":\"medipal\"}" } }

event: content_block_stop
data: { "type": "content_block_stop", "index": 1 }

event: message_delta
data: { "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": {...} }

event: message_stop
data: { "type": "message_stop" }
```

Key facts:

- **Text streams as `text_delta`** events with concatenable `text` field.
- **Tool inputs stream as `input_json_delta`** events with concatenable `partial_json` field. The full input is the concatenation of all `partial_json` chunks for that block. **Parse it as JSON only after `content_block_stop` for that block.**
- **Thinking blocks** stream as `thinking_delta` events (when extended thinking is enabled). Same accumulation pattern as text.
- **Citations** (when enabled) stream as `citations_delta` events on text blocks — see `references/anthropic-citations.md`.

## Accumulator pattern (TypeScript)

```ts
type AccumulatedBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; partialJson: string }
  | { type: "thinking"; thinking: string; signature?: string };

interface StreamAccumulator {
  blocks: AccumulatedBlock[];
  stopReason?: string;
  usage?: { /* ... */ };
}

function applyEvent(acc: StreamAccumulator, event: SSEEvent): void {
  switch (event.type) {
    case "content_block_start": {
      const cb = event.content_block;
      if (cb.type === "text") {
        acc.blocks[event.index] = { type: "text", text: "" };
      } else if (cb.type === "tool_use") {
        acc.blocks[event.index] = { type: "tool_use", id: cb.id, name: cb.name, partialJson: "" };
      } else if (cb.type === "thinking") {
        acc.blocks[event.index] = { type: "thinking", thinking: "" };
      }
      break;
    }
    case "content_block_delta": {
      const block = acc.blocks[event.index];
      if (event.delta.type === "text_delta" && block.type === "text") {
        block.text += event.delta.text;
      } else if (event.delta.type === "input_json_delta" && block.type === "tool_use") {
        block.partialJson += event.delta.partial_json;
      } else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
        block.thinking += event.delta.thinking;
      } else if (event.delta.type === "signature_delta" && block.type === "thinking") {
        block.signature = event.delta.signature;
      }
      break;
    }
    case "content_block_stop": {
      const block = acc.blocks[event.index];
      if (block.type === "tool_use") {
        // safe to JSON.parse(block.partialJson) here
      }
      break;
    }
    case "message_delta": {
      acc.stopReason = event.delta.stop_reason;
      acc.usage = event.usage;
      break;
    }
  }
}
```

The final assembled `messages.push({ role: "assistant", content: ... })` value matches the non-streaming response's `content` array.

## What this means for `runToolUseLoop`

Today, `runToolUseLoop` calls a buffered `caller` and gets the full response. To support streaming, the caller surface widens to also accept a streaming variant:

```ts
export type StreamingAnthropicCaller = (
  params: AnthropicMessageParams,
  options?: { signal?: AbortSignal; onEvent?: (e: StreamEvent) => void }
) => Promise<AnthropicMessageResponse>;
```

The streaming caller still resolves with the full `AnthropicMessageResponse` (the loop needs the assembled content to make tool calls). The `onEvent` hook lets the route handler forward deltas to the client SSE channel as they arrive.

This means **the loop body itself doesn't change** — it still acts on the full response. Streaming is a transport concern handled inside the caller.

## Forwarding to the dashboard

The dashboard's chat client expects the same Anthropic SSE format. The route handler sets up a `TransformStream`:

```
Anthropic → streaming caller → onEvent → re-encode as SSE → client
```

Tool-use blocks should be hidden from the client UI (the dashboard isn't a tool-use debugger), but the assistant's text deltas should stream live. The simplest implementation forwards only `text_delta` events on text blocks, and synthesizes a hidden `event: tool_call` for the client's progress indicator.

## What streaming gives you

- **TTFT improvement.** First text token arrives roughly when the model starts generating, not when it finishes the entire turn including tool calls.
- **Progressive tool-call visibility.** As `input_json_delta` events arrive, you can show "Del is calling `query_project`..." in the UI before the call executes.
- **Better cancellation UX.** Aborts can take effect mid-generation rather than waiting for the response to fully buffer.

## Gotchas

- **Don't parse `partial_json` early.** It's only valid JSON at `content_block_stop`. Mid-stream chunks are deliberately partial.
- **`message_delta` carries final `usage`** — including cache fields. If you log usage telemetry, you must read it from `message_delta`, not `message_start`.
- **Streaming is supported with caching, thinking, and tool use simultaneously.** No combination breaks.
- **Errors mid-stream** arrive as a special `event: error` SSE event. Handle it explicitly.

## References

- Streaming Messages: https://platform.claude.com/docs/en/docs/build-with-claude/streaming
