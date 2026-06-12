# Extended Thinking — Cascade reference

Cascade's Overseer reasons about dispatch decisions in a single forward pass with no intermediate scratchpad. For most turns this is correct — the work is mechanical. For dispatch *decisions* specifically (multi-factor reasoning over project state, recent outcomes, knowledge base, blocker patterns), giving the model thinking time materially improves quality.

## Critical: model selection

| Model | Manual extended thinking | Adaptive thinking |
|-------|-------------------------|-------------------|
| Claude Opus 4.7 | ❌ Not supported (use adaptive) | ✅ Supported |
| Claude Sonnet 4.6 | ⚠️ **Deprecated** — works but use adaptive | ✅ Supported |
| Claude Sonnet 4.5 | ✅ Supported | ✅ Supported |
| Claude Haiku 4.5 | ⚠️ Limited / use adaptive | ✅ Supported |

Cascade is on Sonnet 4.6. **Use adaptive thinking, not manual `thinking: { type: "enabled", budget_tokens: N }`.** Adaptive thinking lets the model decide when reasoning helps and how much budget to spend.

> **Correction (Phase 36, 2026-06-11):** adaptive thinking is **not** automatic on Sonnet 4.6 — the request must explicitly carry `thinking: { "type": "adaptive" }` or the model runs without thinking entirely. (Only Fable 5 has always-on thinking.) Phase 25 shipped the ThinkingBlock round-trip but never sent the param, so the Overseer never actually thought. `runToolUseLoop` now sends it on every request. Note: thinking tokens count toward `max_tokens`, which is why the loop default was raised from 2048 to 16000 at the same time.

If you want a hard guarantee that the model thinks (manual budget), the option is to switch the dispatch-reasoning turn specifically to Sonnet 4.5 with `thinking: enabled`, but that introduces a model split in the codebase. For Phase 25 the simpler path is adaptive on Sonnet 4.6 — measure quality, escalate to manual+4.5 only if adaptive doesn't deliver.

## Manual extended thinking — request shape (Sonnet 4.5 / Opus 4.5)

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000,
    "display": "summarized"
  },
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

Parameters:

- `type`: `"enabled"` for manual thinking
- `budget_tokens`: maximum tokens for internal reasoning. Must be **less than** `max_tokens`. Typical range 1k–10k for an agentic decision; higher for hard reasoning problems.
- `display`: `"summarized"` (default) returns condensed thinking visible in the response. `"omitted"` returns empty thinking block with a signature for caching purposes.

**You are billed for the full thinking tokens, not the summarized output.**

## Response shape

```json
{
  "content": [
    { "type": "thinking", "thinking": "Let me consider...", "signature": "..." },
    { "type": "text", "text": "Based on my analysis..." }
  ]
}
```

Thinking blocks always come **before** text and tool_use blocks in the same assistant turn.

## Tool use integration

### Before tool calls (single thinking turn)

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "I need to call get_outcome_history to evaluate this...", "signature": "..." },
    { "type": "tool_use", "id": "toolu_01...", "name": "query_outcome_history", "input": {"slug": "medipal"} }
  ]
}
```

### Interleaved thinking (between tool calls)

Adaptive thinking on Sonnet 4.6 supports interleaved thinking natively. Manual thinking can also interleave on supported models.

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "...", "signature": "..." },
    { "type": "tool_use", "name": "query_outcome_history", "input": {"slug": "medipal"} },
    { "type": "thinking", "thinking": "Got 3 audits with no signals — proposing continue", "signature": "..." },
    { "type": "tool_use", "name": "propose_dispatch", "input": {"slug": "medipal", "mode": "continue"} }
  ]
}
```

### CRITICAL — preserve thinking blocks across turns

When the loop continues after a tool result, the thinking block from the previous assistant turn **must** be passed back unchanged in the message history. Omitting it will error.

In Cascade's `runToolUseLoop` (`lib/overseer-tools.ts:228`), the assistant turn is already preserved with its full content array:

```ts
messages.push({ role: "assistant", content: response.content });
```

This works for thinking blocks too — `ContentBlock` just needs to widen to include thinking blocks:

```ts
export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;
```

The signature field is opaque — round-trip it without inspecting.

## Tool restrictions when thinking is enabled

- ❌ `tool_choice: { "type": "any" }` — not allowed with thinking
- ❌ `tool_choice: { "type": "tool", "name": "X" }` — not allowed with thinking
- ✅ `tool_choice: { "type": "auto" }` (default) — allowed
- ✅ `tool_choice: { "type": "none" }` — allowed

Cascade uses default `auto`, so no change needed.

## Interaction with prompt caching

| Change | System prompt cache | Message cache |
|--------|---------------------|---------------|
| `budget_tokens` changed | preserved | **invalidated** |
| `type` toggled (enabled/disabled) | preserved | **invalidated** |
| Same params, repeated request | preserved | preserved |

**Practical implication:** if Phase 25 enables thinking only on dispatch-decision turns (not all Overseer turns), the **message cache invalidates between non-thinking and thinking turns**. The system+tools cache survives. Thinking blocks themselves count as input tokens when read back — they live in the message cache, not the system cache.

To keep things simple: pin `budget_tokens` to one value per use case. Do not parameterize it dynamically.

## Pre-warming + thinking is unsupported

`max_tokens: 0` plus `thinking: enabled` returns an error. If you ever pre-warm caches, do it without thinking enabled.

## Streaming

Thinking blocks stream via `thinking_delta` events:

```sse
event: content_block_delta
data: { "type": "content_block_delta", "delta": { "type": "thinking_delta", "thinking": "Let me..." } }
```

With `display: "omitted"`, only `signature_delta` arrives, then text streams. UI shows nothing during thinking — useful when you don't want to expose the model's reasoning.

## Cascade application — Phase 25

The dispatch-decision turn is the natural place for thinking. The signal: when the model is about to call `propose_dispatch`, give it room to reason.

Two clean implementation paths:

**Path A — Adaptive thinking on Sonnet 4.6 (recommended, shipped in Phase 36):**
- Send `thinking: { "type": "adaptive" }` on every request (done in `runToolUseLoop`). It is NOT implicit on Sonnet 4.6.
- Thinking blocks (or signatures) appear in `response.content`. `runToolUseLoop` widens `ContentBlock` to include them; pass-through preserves them.
- Cost: thinking tokens are billed but not exposed.
- The benefit shows up as better proposals; instrument outcome quality (Phase 24's `query_outcome_history` data) to validate.

**Path B — Manual thinking on Sonnet 4.5 for the dispatch turn only:**
- Adds a model split. Most Overseer turns stay on 4.6; the dispatch-decision turn switches to 4.5 with `thinking: { type: "enabled", budget_tokens: 5000 }`.
- More code (per-turn model selection logic) and breaks message caching across the boundary.
- Defer unless Path A doesn't deliver.

Start with Path A. The eval suite will tell you if it's enough.

## References

- Extended thinking: https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
- Adaptive thinking: linked from the same page
