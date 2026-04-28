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

// Anthropic message content block shapes (subset we use).
export type TextBlock = { type: "text"; text: string };
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
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessageParams {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  max_tokens?: number;
}

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicCaller = (
  params: AnthropicMessageParams
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
    maxTokens = 2048,
  } = params;

  const messages: AnthropicMessage[] = [...initialMessages];
  let toolCallsExecuted = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await caller({
      model,
      system: systemPrompt,
      // Pass a fresh array slice so callers (especially test mocks
      // that capture params) see a snapshot at call-time rather than
      // a live reference we keep mutating.
      messages: [...messages],
      tools: registry.toAnthropicTools(),
      max_tokens: maxTokens,
    });

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
      const result = await registry.execute(block.name, block.input, ctx);
      toolCallsExecuted++;
      if (result.ok) {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: stringifyToolOutput(result.output),
        });
      } else {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.error,
          is_error: true,
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
 */
export function defaultAnthropicCaller(apiKey: string): AnthropicCaller {
  return async (params) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${text}`);
    }
    return (await response.json()) as AnthropicMessageResponse;
  };
}
