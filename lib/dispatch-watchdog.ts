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
    // Phase 37 [36.A1] — queue jobs are keyed by idempotencyKey, so
    // the release uses it directly (no project lookup needed).
    queue.release(row.idempotencyKey);
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

export interface ReconcileResult {
  /** Number of orphaned queued rows flipped to failed. */
  orphaned: number;
  /** Idempotency keys of the rows acted on. */
  keys: string[];
}

/**
 * Phase 37 [36.A2] — boot reconciliation.
 *
 * A Dispatch row still in `queued` when a process starts is orphaned
 * by definition: the enqueue closure that would transition it died
 * with the previous process, so it can never reach `started`. Flip it
 * to `failed` so it doesn't sit in the UI as in-flight forever.
 *
 * `started` rows are deliberately left alone — their external Claude
 * session may still be running; the webhook completes them or the
 * watchdog times them out at `expectedBy`.
 *
 * Call once at process start (instrumentation register / predev), not
 * on a tick.
 */
export async function reconcileOrphanedDispatches(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<ReconcileResult> {
  const orphans = await prisma.dispatch.findMany({
    where: { status: "queued" },
    select: { id: true, idempotencyKey: true, projectId: true },
  });

  const keys: string[] = [];
  for (const row of orphans) {
    await prisma.dispatch.update({
      where: { id: row.id },
      data: {
        status: "failed",
        errorMessage: "orphaned by server restart",
        completedAt: now,
      },
    });
    await prisma.activityEvent.create({
      data: {
        projectId: row.projectId,
        eventType: "dispatch-orphaned",
        summary: `Dispatch ${row.idempotencyKey.slice(0, 8)} orphaned by server restart`,
        details: JSON.stringify({
          dispatchId: row.id,
          idempotencyKey: row.idempotencyKey,
          reconciledAt: now.toISOString(),
        }),
      },
    });
    keys.push(row.idempotencyKey);
  }
  return { orphaned: orphans.length, keys };
}
