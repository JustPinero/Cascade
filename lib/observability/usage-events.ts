/**
 * Phase 23.3 — query helper for /observability/cache.
 *
 * Returns recent AnthropicUsageEvent rows with a derived hitRate per
 * row. Pagination is cursor-based (last seen id).
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

export interface GetUsageEventsOptions {
  callSite?: string;
  model?: string;
  since?: Date;
  until?: Date;
  /** Cursor: return rows with id < this value. Default: latest. */
  cursorId?: number;
  /** Page size. Default 100. Max 500. */
  pageSize?: number;
}

export interface UsageEventRow {
  id: number;
  callSite: string;
  model: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: Date;
  /** cacheRead / (cacheRead + cacheCreate + uncachedInput); 0 when no input. */
  hitRate: number;
}

export interface GetUsageEventsResult {
  rows: UsageEventRow[];
  nextCursor: number | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export function computeHitRate(row: {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): number {
  const total =
    row.cacheReadInputTokens +
    row.cacheCreationInputTokens +
    row.inputTokens;
  if (total === 0) return 0;
  return row.cacheReadInputTokens / total;
}

export async function getUsageEvents(
  prisma: PrismaClient,
  opts: GetUsageEventsOptions = {}
): Promise<GetUsageEventsResult> {
  const pageSize = Math.min(
    opts.pageSize ?? DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  const where: Record<string, unknown> = {};
  if (opts.callSite) where.callSite = opts.callSite;
  if (opts.model) where.model = opts.model;
  if (opts.since || opts.until) {
    const range: Record<string, Date> = {};
    if (opts.since) range.gte = opts.since;
    if (opts.until) range.lte = opts.until;
    where.createdAt = range;
  }
  if (opts.cursorId !== undefined) {
    where.id = { lt: opts.cursorId };
  }

  // Fetch one extra to detect whether a next page exists.
  const fetched = await prisma.anthropicUsageEvent.findMany({
    where,
    orderBy: { id: "desc" },
    take: pageSize + 1,
  });

  const hasMore = fetched.length > pageSize;
  const sliced = hasMore ? fetched.slice(0, pageSize) : fetched;

  const rows: UsageEventRow[] = sliced.map((r) => ({
    id: r.id,
    callSite: r.callSite,
    model: r.model,
    inputTokens: r.inputTokens,
    cacheReadInputTokens: r.cacheReadInputTokens,
    cacheCreationInputTokens: r.cacheCreationInputTokens,
    cacheCreation5mTokens: r.cacheCreation5mTokens,
    cacheCreation1hTokens: r.cacheCreation1hTokens,
    outputTokens: r.outputTokens,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    hitRate: computeHitRate(r),
  }));

  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

  return { rows, nextCursor };
}
