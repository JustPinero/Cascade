import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Phase 12A.2 — Tool framework for the Overseer.
 *
 * The Overseer is migrating from a "stuff-everything-in-the-system-prompt
 * + parse-tags-from-prose" pattern to a tool-using agent. This module
 * provides the registry, types, and execution loop that downstream
 * tools (12A.3 query_project, then more in Phase B/C) plug into.
 */

// -- Types -------------------------------------------------------------

export interface ToolContext {
  prisma: PrismaClient;
  /** ChatSession id; required for tools that read/write working memory. */
  sessionId?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** JSON Schema. Sent to the Anthropic API; the model validates inputs against it. */
  inputSchema: Record<string, unknown>;
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

export type ToolExecutionResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

// Phase 23.4 — prompt caching surface.
// `cache_control` may attach to text blocks (system or message
// content), or to tool definitions (typically the last one). The
// Anthropic API caches the prefix up to and including the marked
// block. See references/prompt-caching.md for placement strategy.
export type CacheControl = { type: "ephemeral"; ttl?: "1h" };

// Anthropic message content block shapes (subset we use).
export type TextBlock = {
  type: "text";
  text: string;
  cache_control?: CacheControl;
};
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: CacheControl;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: CacheControl;
};
/**
 * Phase 25.1 — Sonnet 4.6's adaptive thinking may emit thinking
 * blocks alongside text/tool_use in assistant turns. The model's
 * `signature` field is opaque — pass through unchanged. When tool
 * use chains across turns, the thinking blocks MUST round-trip
 * verbatim or the next request 400s.
 */
export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

/**
 * Phase 23.4 — system can be a plain string (legacy) or an array of
 * cached text blocks. Use the array form when you want a cache marker
 * on the system prompt itself; for tool-using paths, marking the last
 * tool is usually preferred (covers system + tools as one prefix).
 */
export type SystemBlock =
  | string
  | Array<{
      type: "text";
      text: string;
      cache_control?: CacheControl;
    }>;

/**
 * Phase 36 — adaptive thinking config. On Sonnet 4.6 adaptive thinking
 * is NOT automatic: the request must carry `thinking: {type:"adaptive"}`
 * or the model runs without thinking. (Phase 25 assumed it was implicit
 * — it isn't; this closes that gap.) `budget_tokens` is deprecated on
 * 4.6-family models and intentionally not modeled here.
 */
export type ThinkingConfig = { type: "adaptive" };

export interface AnthropicMessageParams {
  model: string;
  system: SystemBlock;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  max_tokens?: number;
  thinking?: ThinkingConfig;
}

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  /**
   * Phase 23.4 — usage now exposes cache hit/write counters when
   * cache_control markers are present in the request. All cache fields
   * are optional because requests without markers produce responses
   * without those fields.
   */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
}

export type AnthropicCaller = (
  params: AnthropicMessageParams,
  options?: { signal?: AbortSignal }
) => Promise<AnthropicMessageResponse>;

// -- ToolRegistry -----------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as Tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  toAnthropicTools(): AnthropicToolDefinition[] {
    // Phase 42 (P0.3) — NO cache marker here. The API renders
    // tools → system → messages, so the old last-tool marker cached
    // tools ONLY (Phase 23.4 had the render order backwards). The
    // breakpoint now lives on the system block in runToolUseLoop,
    // which caches the tools+system prefix together and frees a
    // breakpoint slot. See references/prompt-caching.md.
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  async execute(
    name: string,
    input: unknown,
    ctx: ToolContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
    try {
      const output = await tool.handler(input, ctx);
      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}

// -- runToolUseLoop ---------------------------------------------------

export interface ToolUseLoopParams {
  caller: AnthropicCaller;
  model: string;
  systemPrompt: string;
  messages: AnthropicMessage[];
  registry: ToolRegistry;
  ctx: ToolContext;
  maxIterations?: number;
  maxTokens?: number;
  /**
   * Optional abort signal — propagated to each `caller` invocation.
   * If aborted between iterations, the loop returns immediately with
   * `truncated: true`. Tools-in-flight are not interrupted; only the
   * outer caller call respects the signal.
   */
  signal?: AbortSignal;
}

export interface ToolUseLoopResult {
  /** Full message log including assistant tool_use messages and user tool_result messages. */
  messages: AnthropicMessage[];
  /** Concatenated text of the terminal assistant turn. Empty if truncated before terminal. */
  finalText: string;
  toolCallsExecuted: number;
  /** True if the loop bailed at maxIterations without reaching a terminal text turn. */
  truncated: boolean;
}

function extractToolUseBlocks(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === "tool_use");
}

function extractTextBlocks(content: ContentBlock[]): TextBlock[] {
  return content.filter((b): b is TextBlock => b.type === "text");
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Phase 42 (P0.3) — rolling message breakpoint.
 *
 * Returns a snapshot of `messages` with exactly one cache marker: on
 * the last content block of the last message. All other markers (the
 * compressor's summary marker, or markers added for a previous
 * iteration) are stripped so repeated calls never accumulate toward
 * the API's 4-breakpoint limit.
 *
 * Why this works: the cache entry written at call N covers the whole
 * prefix through N's last block. Call N+1 re-sends that prefix
 * unchanged (plus the new assistant/tool_result turns), so it READS
 * N's entry and writes a new one at its own tail — each iteration
 * re-pays only the new suffix instead of the entire history.
 *
 * Pure: input messages and their blocks are never mutated. A last
 * message with string content is converted (in the snapshot only) to
 * an equivalent single text block so it can carry the marker; empty
 * strings are left alone (the API rejects empty text blocks).
 */
export function withRollingCacheMarker(
  messages: AnthropicMessage[]
): AnthropicMessage[] {
  const stripped: AnthropicMessage[] = messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    let touched = false;
    const content = msg.content.map((block) => {
      if ("cache_control" in block && block.cache_control) {
        touched = true;
        const { cache_control: _drop, ...rest } = block as ContentBlock & {
          cache_control?: CacheControl;
        };
        void _drop;
        return rest as ContentBlock;
      }
      return block;
    });
    return touched ? { ...msg, content } : msg;
  });

  if (stripped.length === 0) return stripped;
  const last = stripped[stripped.length - 1];

  if (typeof last.content === "string") {
    if (last.content === "") return stripped;
    stripped[stripped.length - 1] = {
      ...last,
      content: [
        {
          type: "text",
          text: last.content,
          cache_control: { type: "ephemeral" },
        },
      ],
    };
    return stripped;
  }

  if (last.content.length === 0) return stripped;
  const blocks = [...last.content];
  const tail = blocks[blocks.length - 1];
  // The API rejects cache_control on thinking blocks. In practice the
  // last message before a call is always user-role (initial turn or
  // tool_results), so this guard is defensive.
  if (tail.type === "thinking") return stripped;
  blocks[blocks.length - 1] = {
    ...tail,
    cache_control: { type: "ephemeral" },
  };
  stripped[stripped.length - 1] = { ...last, content: blocks };
  return stripped;
}

export async function runToolUseLoop(
  params: ToolUseLoopParams
): Promise<ToolUseLoopResult> {
  const {
    caller,
    model,
    systemPrompt,
    messages: initialMessages,
    registry,
    ctx,
    maxIterations = 8,
    // Phase 36 — was 2048, which adaptive thinking can eat entirely
    // (thinking tokens count toward max_tokens), truncating the visible
    // reply. 16K is the recommended non-streaming ceiling; cost only
    // accrues for tokens actually generated.
    maxTokens = 16000,
    signal,
  } = params;

  const messages: AnthropicMessage[] = [...initialMessages];
  let toolCallsExecuted = 0;

  // Phase 42 (P0.3) — the system breakpoint caches the tools+system
  // prefix (render order is tools → system → messages; the old
  // last-tool marker cached tools only). Built once: the prompt is
  // byte-stable across iterations.
  const system: SystemBlock = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Honor abort between iterations. Mid-iteration abort happens
    // inside the caller via the signal we pass down.
    if (signal?.aborted) {
      return { messages, finalText: "", toolCallsExecuted, truncated: true };
    }
    const response = await caller(
      {
        model,
        system,
        // Phase 42 (P0.3) — rolling breakpoint on the last block of the
        // last message: iteration N+1 cache-READS iteration N's prefix
        // instead of re-paying the whole history. Also a fresh snapshot
        // so caller-side captures aren't a live reference we mutate.
        messages: withRollingCacheMarker(messages),
        tools: registry.toAnthropicTools(),
        max_tokens: maxTokens,
        // Phase 36 — explicitly enable adaptive thinking. Without this
        // param Sonnet 4.6 never thinks; the ThinkingBlock round-trip
        // below has been ready since Phase 25.1.
        thinking: { type: "adaptive" },
      },
      { signal }
    );

    const toolUseBlocks = extractToolUseBlocks(response.content);

    if (toolUseBlocks.length === 0) {
      // Terminal text turn — concatenate all text blocks and return.
      const finalText = extractTextBlocks(response.content)
        .map((b) => b.text)
        .join("");
      messages.push({ role: "assistant", content: finalText });
      return { messages, finalText, toolCallsExecuted, truncated: false };
    }

    // Tool turn — preserve the full content array as the assistant message.
    messages.push({ role: "assistant", content: response.content });

    const toolResultBlocks: ToolResultBlock[] = [];
    for (const block of toolUseBlocks) {
      const callStart = performance.now();
      const result = await registry.execute(block.name, block.input, ctx);
      const durationMs = Math.round(performance.now() - callStart);
      toolCallsExecuted++;

      let outputContent: string;
      if (result.ok) {
        outputContent = stringifyToolOutput(result.output);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: outputContent,
        });
      } else {
        outputContent = result.error;
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: outputContent,
          is_error: true,
        });
      }

      // Phase 24.2 — fire-and-forget tool-call telemetry. Uses
      // ctx.prisma so scratch-SQLite tests see the writes. Wrapped
      // in try/catch + optional chaining + .catch() so:
      //   - synchronous errors (prisma disconnected mid-microtask
      //     when a test completes) don't escape to the test runner
      //   - async errors (insert reject) get logged in production
      //     and swallowed in test
      if (ctx.sessionId) {
        const sessionId = ctx.sessionId;
        const inputJson = stringifyToolOutput(block.input).slice(0, 4096);
        const outputSize = outputContent.length;
        const errorMessage = result.ok ? null : result.error;
        const telemetryPrisma = ctx.prisma;
        queueMicrotask(() => {
          try {
            const promise = telemetryPrisma.toolCallEvent?.create({
              data: {
                sessionId,
                iteration,
                toolName: block.name,
                input: inputJson,
                outputSize,
                success: result.ok,
                errorMessage,
                durationMs,
              },
            });
            promise?.catch((err: unknown) => {
              if (process.env.NODE_ENV !== "test") {
                console.warn(
                  `[tool-call-telemetry] insert failed for ${block.name}: ${
                    err instanceof Error ? err.message : String(err)
                  }`
                );
              }
            });
          } catch {
            // Ignore — prisma is gone (test disposed) or the schema
            // doesn't carry the model. Telemetry must never throw.
          }
        });
      }
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  // Bailed at maxIterations.
  return { messages, finalText: "", toolCallsExecuted, truncated: true };
}

// -- Default Anthropic caller ----------------------------------------

/**
 * Default caller that hits the Anthropic Messages API directly. Kept
 * outside the loop so tests can pass their own mock without touching
 * fetch. Not used by tests.
 *
 * Phase 23.3 — emits an `AnthropicUsageEvent` row per request via
 * fire-and-forget logUsage. The row reports input/output/cache token
 * counts; the cache columns default to zero pre-23.4 (no cache_control
 * markers yet), then climb once 23.4 ships.
 */
export function defaultAnthropicCaller(apiKey: string): AnthropicCaller {
  return async (params, options) => {
    const start = performance.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(params),
      signal: options?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${text}`);
    }
    const json = (await response.json()) as AnthropicMessageResponse;
    // Lazy import to avoid a circular dep — overseer-tools is imported
    // by lib/db's consumers, and anthropic-usage-log imports from
    // app/generated/prisma which is heavier.
    const { logUsage } = await import("./anthropic-usage-log");
    const { prisma } = await import("./db");
    logUsage(prisma, {
      callSite: "overseer.chat",
      model: params.model,
      usage: json.usage as unknown as Parameters<typeof logUsage>[1]["usage"],
      durationMs: Math.round(performance.now() - start),
    });
    return json;
  };
}
