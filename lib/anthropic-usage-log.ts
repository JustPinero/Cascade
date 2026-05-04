/**
 * Phase 23.3 — Anthropic usage telemetry.
 *
 * Every Cascade call site that POSTs to api.anthropic.com writes one
 * `AnthropicUsageEvent` row via `logUsage`. Powers the
 * `/observability/cache` page and protects 23.4's caching rollout
 * from silent regression — without telemetry there's no way to prove
 * cache hits land or detect when someone destabilizes a prefix.
 *
 * Fire-and-forget by contract: the caller does not wait for the
 * Prisma insert. A slow or failing telemetry write must never add
 * latency or error to a production Anthropic request.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Subset of the Anthropic Messages API response.usage shape that
 * matters for cache observability. All fields are optional because
 * older responses (and non-cached requests) omit cache fields.
 */
export interface AnthropicResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

/**
 * Map an Anthropic response.usage payload to the row's columns.
 * Centralized here so adding a new usage field in the future only
 * touches one place.
 */
export function extractUsageFields(usage: AnthropicResponseUsage | undefined) {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheCreation5mTokens:
      usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    cacheCreation1hTokens:
      usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

export interface UsageEventInput {
  callSite: string;
  model: string;
  usage: AnthropicResponseUsage | undefined;
  durationMs: number;
}

/**
 * Insert a usage event row. Fire-and-forget: the function returns to
 * the caller immediately. Errors are caught and logged (suppressed in
 * `NODE_ENV === "test"`) — they must never propagate.
 */
export function logUsage(prisma: PrismaClient, input: UsageEventInput): void {
  const fields = extractUsageFields(input.usage);
  // queueMicrotask defers the insert until the current call stack
  // unwinds, so the caller never sees the latency. The promise
  // returned by .create is intentionally not awaited; errors are
  // swallowed inside the .catch.
  queueMicrotask(() => {
    prisma.anthropicUsageEvent
      .create({
        data: {
          callSite: input.callSite,
          model: input.model,
          ...fields,
          durationMs: input.durationMs,
        },
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== "test") {
          // eslint-disable-next-line no-console
          console.warn(
            `[anthropic-usage-log] insert failed for ${input.callSite}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      });
  });
}
