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
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
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
    const tools: AnthropicToolDefinition[] = this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
    // Phase 23.4 — mark the last tool with cache_control so the API
    // caches the entire system + tools prefix. Sonnet 4.6's minimum
    // cacheable size is 2,048 tokens; the system prompt alone is
    // below that threshold but system + 14+ tools comfortably
    // exceeds it. See references/prompt-caching.md.
    if (tools.length > 0) {
      tools[tools.length - 1].cache_control = { type: "ephemeral" };
    }
    return tools;
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

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Honor abort between iterations. Mid-iteration abort happens
    // inside the caller via the signal we pass down.
    if (signal?.aborted) {
      return { messages, finalText: "", toolCallsExecuted, truncated: true };
    }
    const response = await caller(
      {
        model,
        system: systemPrompt,
        // Pass a fresh array slice so callers (especially test mocks
        // that capture params) see a snapshot at call-time rather than
        // a live reference we keep mutating.
        messages: [...messages],
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
