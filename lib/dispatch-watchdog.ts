/**
 * Phase 23.2 — Dispatch watchdog.
 *
 * Scans for Dispatch rows in `queued` or `started` status whose
 * `expectedBy` deadline has passed, flips them to `timeout`, and
 * releases their queue slots so a new dispatch can use them.
 *
 * Idempotent — running twice in a row is a no-op on the second pass.
 * Safe to call from a Next.js cron, a scheduled script, or directly
 * from tests via `runDispatchWatchdog(prisma, queue)`.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { DispatchQueue } from "./dispatch-queue";

export interface WatchdogResult {
  /** Number of Dispatch rows flipped from queued/started to timeout. */
  timedOut: number;
  /** Idempotency keys of the rows the watchdog acted on. */
  keys: string[];
}

export async function runDispatchWatchdog(
  prisma: PrismaClient,
  queue: DispatchQueue,
  now: Date = new Date()
): Promise<WatchdogResult> {
  const stale = await prisma.dispatch.findMany({
    where: {
      status: { in: ["queued", "started"] },
      expectedBy: { lt: now },
    },
    select: {
      id: true,
      idempotencyKey: true,
      projectId: true,
    },
  });

  if (stale.length === 0) {
    return { timedOut: 0, keys: [] };
  }

  const keys: string[] = [];
  for (const row of stale) {
    await prisma.dispatch.update({
      where: { id: row.id },
      data: { status: "timeout", completedAt: now },
    });
    // Release the queue slot keyed by projectPath — but we don't
    // have the project path on hand from the select above. Resolve via
    // project.path so legacy projectPath-keyed slots clear correctly.
    const project = await prisma.project.findUnique({
      where: { id: row.projectId },
      select: { path: true },
    });
    if (project) {
      queue.release(project.path);
    }
    await prisma.activityEvent.create({
      data: {
        projectId: row.projectId,
        eventType: "dispatch-timeout",
        summary: `Dispatch ${row.idempotencyKey.slice(0, 8)} timed out`,
        details: JSON.stringify({
          dispatchId: row.id,
          idempotencyKey: row.idempotencyKey,
          timedOutAt: now.toISOString(),
        }),
      },
    });
    keys.push(row.idempotencyKey);
  }
  return { timedOut: stale.length, keys };
}
