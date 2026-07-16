# Prompt Caching — Cascade reference

The Anthropic API caches request prefixes you mark with `cache_control`. Hits cost 10% of the input rate; writes cost 125% (5-min) or 200% (1-hour). For Cascade's Overseer chat, marking the stable system+tools prefix as cached drops Overseer input cost dramatically and improves time-to-first-token on every turn after the first.

## Critical model thresholds

| Model | Minimum cacheable tokens |
|-------|--------------------------|
| Claude Opus 4.7 | 4,096 |
| Claude Sonnet 4.6 | **2,048** |
| Claude Sonnet 4.5 | 1,024 |
| Claude Haiku 4.5 | **4,096** |
| Claude Haiku 3.5 | 2,048 |

**This matters for Cascade.** The Overseer system prompt alone (`TOOL_PATH_SYSTEM_PROMPT` in `app/api/overseer/chat/route.ts`) is ~1,700 tokens — **below** the Sonnet 4.6 threshold. Caching the system prompt as a standalone prefix would silently do nothing. But the API renders requests **tools → system → messages**, so a breakpoint on the *system block* caches tools + system together (≥ 7K tokens combined), well past the threshold. **Phase 42 correction:** this document previously recommended marking the last *tool*, claiming it covered system too — that had the render order backwards. A last-tool marker caches *tools only*; the system prompt and all messages were re-billed every call.

The Haiku summarizer in `lib/chat-history-compressor.ts:defaultSummarizer` has a ~100-token system prompt and a transcript message. It will not benefit from caching at any reasonable shape — leave it alone.

## API mechanics

- **Up to 4 cache breakpoints per request.** A "breakpoint" is any block with `cache_control` set. The system caches the prefix ending at each breakpoint independently, with longest-matching-prefix lookup at request time.
- **Lookback window: 20 blocks per breakpoint.** Cache reads walk backwards up to 20 positions looking for a prior write that matches.
- **Cache writes happen only at breakpoints**, not at every block boundary.
- **TTL options:** `{ "type": "ephemeral" }` (5-minute, default) or `{ "type": "ephemeral", "ttl": "1h" }`. Costs: 1.25× write for 5-min, 2.0× write for 1-hour, 0.1× read for either.
- **1-hour entries must precede 5-minute entries** in the request. Enforced by API.
- **Streaming is fully supported** with cached prefixes — cached content reads from cache, new content streams normally.
- **Pre-warming:** `max_tokens: 0` writes the cache without generating output. `stop_reason` returns `"max_tokens"` and content is empty. Useful only for batch use cases; not relevant to the Overseer.

## What invalidates a cache

Listed in order of broadest blast radius:

| Change | Tools | System | Messages |
|--------|-------|--------|----------|
| Tool definitions modified | invalidates | invalidates | invalidates |
| Tool choice changed | invalidates | invalidates | unchanged |
| Images added/removed | invalidates | invalidates | unchanged |
| Thinking parameters changed | invalidates | invalidates | unchanged |
| System prompt text changed | unchanged | invalidates | unchanged |
| Earlier message content changed | unchanged | unchanged | invalidates |

Two practical implications for Cascade:

1. The `buildDefaultRegistry()` singleton is the entire reason caching works for the Overseer. Rebuilding it per-request, or filtering tools per-request, would invalidate the tools cache on every call. Don't.
2. If you ever add `thinking: { type: "enabled" }` to the Overseer chat path, every change to `budget_tokens` invalidates message-level caching. Pin a budget per use case.

## Required code change to `AnthropicMessageParams`

The current interface in `lib/overseer-tools.ts` is:

```ts
export interface AnthropicMessageParams {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  max_tokens?: number;
}
```

To support caching, `system` needs to accept the array form, and tool definitions need an optional `cache_control`:

```ts
export type SystemBlock =
  | string
  | Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: "1h" };
    }>;

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

export interface AnthropicMessageParams {
  model: string;
  system: SystemBlock;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  max_tokens?: number;
  // Anthropic returns these in usage even when not requested:
  // cache_creation_input_tokens, cache_read_input_tokens
}

export interface AnthropicMessageResponse {
  // ...
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
}
```

`defaultAnthropicCaller` needs no change beyond passing the body through — `JSON.stringify(params)` still works.

## Cascade-specific patterns

### Pattern 1 — Overseer chat (the must-do)

Mark `cache_control` on the **system block** (the `SystemBlock` array form): render order is tools → system → messages, so a system breakpoint caches the entire tools + system prefix as one unit. Do NOT mark the last tool — a tool-level breakpoint sits *upstream* of system and caches tools only (the pre-Phase-42 mistake). `runToolUseLoop` additionally rolls a single `cache_control` marker onto the last content block of the last message each iteration (stripping stale markers), so iteration N+1 cache-reads iteration N's full prefix instead of re-paying the conversation history. Budget: system + rolling message marker = 2 of the 4 allowed breakpoints.

```ts
// In ToolRegistry.toAnthropicTools(), after gathering all tools:
const tools = this.list().map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}));
if (tools.length > 0) {
  tools[tools.length - 1].cache_control = { type: "ephemeral" };
}
return tools;
```

One change, one file (`lib/overseer-tools.ts`). Affects every call site that uses `registry.toAnthropicTools()`.

### Pattern 2 — Per-project chat

`app/api/projects/[slug]/chat/route.ts` builds a system prompt from CLAUDE.md + handoff + debt + current request + lessons. That string is dynamic across projects but **stable within a single project session.** Wrap as an array with `cache_control` on the single text block:

```ts
const systemBlock: SystemBlock = [
  { type: "text", text: builtSystemPrompt, cache_control: { type: "ephemeral" } },
];
```

Cache hits land for the second turn onward in the same project chat.

### Pattern 3 — Compressed history

When `compressMessagesForSession` returns a synthetic `[Earlier conversation summary — ...]` user message at index 0, that message is stable for the rest of the session. Mark its content as cached:

```ts
function formatSummaryAsMessage(summary: string): AnthropicMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `[Earlier conversation summary — older turns compressed]\n\n${summary}`,
        cache_control: { type: "ephemeral" },
      } as ContentBlock,
    ],
  };
}
```

Now the cache prefix for an Overseer chat extends through the summary message. (This requires `AnthropicMessage.content`'s string form to also support array form for cache markers — the existing `ContentBlock[]` shape already accepts `text` blocks; widen the formatter to use it.)

### Pattern 4 — Feature proposer

`lib/anthropic-feature-proposer.ts` calls Anthropic in bursts when `proposeForAll()` iterates feature gaps. Use `ttl: "1h"` because the burst spans minutes:

```ts
system: [
  { type: "text", text: PROPOSAL_SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } },
],
```

Verify the system prompt is large enough — if it's under 2,048 tokens for Sonnet 4.6, the cache silently no-ops.

## Telemetry — measure or don't bother

Cache hit rate is unobservable without logging the `usage` fields. Without telemetry, you cannot prove caching landed and you cannot detect regression when someone destabilizes the prefix.

Schema:

```prisma
model AnthropicUsageEvent {
  id                          Int      @id @default(autoincrement())
  callSite                    String                              // "overseer.chat" | "project.chat" | "summarizer" | "feature-proposer"
  model                       String
  inputTokens                 Int                                 // post-breakpoint, uncached
  cacheReadInputTokens        Int      @default(0)
  cacheCreationInputTokens    Int      @default(0)
  cacheCreation5mTokens       Int      @default(0)
  cacheCreation1hTokens       Int      @default(0)
  outputTokens                Int
  durationMs                  Int
  createdAt                   DateTime @default(now())

  @@index([callSite, createdAt])
  @@index([createdAt])
}
```

Hit-rate = `cacheReadInputTokens / (cacheReadInputTokens + cacheCreationInputTokens + inputTokens)` over a window. Healthy Overseer hit rate after warmup: 60–80%. Drops below 50% on a PR → someone destabilized the prefix. That's a regression signal worth alerting on.

## Common mistakes to avoid

- **Putting the breakpoint after dynamic content.** A cache marker after a "current time" or "current project list" string never hits because the prefix hash changes every request.
- **Caching content under the model's threshold.** Silently no-ops. Always cross-check size against the table above.
- **Trusting absence of error.** The API does not error if caching can't fire. The only way to know is to read `cache_read_input_tokens` from the response.
- **Caching the working memory snapshot.** Don't. Cascade's working memory lives in Prisma and is read via `get_session_state` tool calls — out of the request body. Inlining it would destroy the cache hit rate every turn it changes. Preserve this design.
- **Forgetting that thinking parameter changes invalidate caches.** If you parameterize `budget_tokens` by call type, you'll have one cache class per budget. Pin per call site.

## Verification checklist

After wiring caching at any call site:

1. Make 2 identical requests in close succession. The second should show non-zero `cache_read_input_tokens` and zero `cache_creation_input_tokens`.
2. Check `input_tokens` in the second response is small (just the dynamic suffix).
3. Run a snapshot test on the request body shape so silent prompt drift fails CI.
4. After a week of production traffic, query `AnthropicUsageEvent` for hit rate per call site.

## References

- Caching costs and breakpoint rules: https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
- The interaction with extended thinking: see `references/anthropic-extended-thinking.md`
