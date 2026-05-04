/**
 * Phase 24.2 — query helper for /observability/tools.
 *
 * Mirrors the shape of getUsageEvents (cursor pagination, filters)
 * so /observability/tools and /observability/cache feel consistent.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

export interface GetToolCallEventsOptions {
  toolName?: string;
  sessionId?: string;
  success?: boolean;
  since?: Date;
  until?: Date;
  cursorId?: number;
  pageSize?: number;
}

export interface ToolCallEventRow {
  id: number;
  sessionId: string;
  iteration: number;
  toolName: string;
  input: string;
  outputSize: number;
  success: boolean;
  errorMessage: string | null;
  durationMs: number;
  createdAt: Date;
}

export interface GetToolCallEventsResult {
  rows: ToolCallEventRow[];
  nextCursor: number | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export async function getToolCallEvents(
  prisma: PrismaClient,
  opts: GetToolCallEventsOptions = {}
): Promise<GetToolCallEventsResult> {
  const pageSize = Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const where: Record<string, unknown> = {};
  if (opts.toolName) where.toolName = opts.toolName;
  if (opts.sessionId) where.sessionId = opts.sessionId;
  if (typeof opts.success === "boolean") where.success = opts.success;
  if (opts.since || opts.until) {
    const range: Record<string, Date> = {};
    if (opts.since) range.gte = opts.since;
    if (opts.until) range.lte = opts.until;
    where.createdAt = range;
  }
  if (opts.cursorId !== undefined) where.id = { lt: opts.cursorId };

  const fetched = await prisma.toolCallEvent.findMany({
    where,
    orderBy: { id: "desc" },
    take: pageSize + 1,
  });

  const hasMore = fetched.length > pageSize;
  const sliced = hasMore ? fetched.slice(0, pageSize) : fetched;

  const rows: ToolCallEventRow[] = sliced.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    iteration: r.iteration,
    toolName: r.toolName,
    input: r.input,
    outputSize: r.outputSize,
    success: r.success,
    errorMessage: r.errorMessage,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
  }));

  return {
    rows,
    nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
  };
}
