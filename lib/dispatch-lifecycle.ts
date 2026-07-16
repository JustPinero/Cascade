/**
 * Phase 23.2 — Dispatch lifecycle helper.
 *
 * Wraps the queue-and-spawn flow with Dispatch row state transitions:
 * queued → started → (completed | failed). Every dispatch entry point
 * (dispatchClaude, dispatchAll, dispatchBatch, dispatchTeam) routes
 * through this helper so the Dispatch table is the single source of
 * truth for in-flight work.
 *
 * The webhook (Stop hook) transitions started → completed by reading
 * `idempotencyKey` from the spawned session's environment. The
 * watchdog transitions queued/started → timeout when `expectedBy`
 * passes without a webhook ping.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { DispatchMode } from "./claude-dispatcher";
import { getDispatchQueue } from "./dispatch-queue";

export interface DispatchLifecycleSpec {
  project: { id: number; slug: string; path: string };
  mode: DispatchMode;
  prompt?: string;
  customPrompt?: string;
  healthAtDispatch?: string;
  /** Watchdog deadline. Default 30 minutes from enqueue. */
  expectedByMs?: number;
  /**
   * The actual spawn work. Receives the freshly-generated
   * idempotencyKey so the spawn can pass it through as
   * `CASCADE_DISPATCH_ID` in the child process environment. Throws
   * propagate as a `failed` Dispatch transition.
   */
  spawnFn: (idempotencyKey: string) => Promise<void> | void;
}

export interface DispatchLifecycleResult {
  idempotencyKey: string;
  dispatchId: string;
}

const DEFAULT_EXPECTED_BY_MS = 30 * 60 * 1000;

export async function enqueueWithDispatchRow(
  prisma: PrismaClient,
  spec: DispatchLifecycleSpec
): Promise<DispatchLifecycleResult> {
  const expectedBy = new Date(
    Date.now() + (spec.expectedByMs ?? DEFAULT_EXPECTED_BY_MS)
  );

  const dispatch = await prisma.dispatch.create({
    data: {
      projectId: spec.project.id,
      projectSlug: spec.project.slug,
      mode: spec.mode,
      customPrompt: spec.customPrompt,
      prompt: spec.prompt,
      status: "queued",
      healthAtDispatch: spec.healthAtDispatch,
      expectedBy,
    },
  });

  const queue = getDispatchQueue();
  await queue.enqueue({
    // Phase 37 [36.A1] — keyed by idempotencyKey, not project.path.
    // Path keys collided for same-project dispatches (the running Set
    // deduped them) and releases missed on byte differences between
    // project.path and the Stop hook's projectPath.
    id: dispatch.idempotencyKey,
    dispatch: async () => {
      // Phase 42 (P0.2a) — guarded transition: only a row still
      // `queued` may start. The watchdog can flip a long-pending row
      // to `timeout` while it waits for a slot (or a standalone sweep
      // to `failed`); spawning it anyway resurrected dispatches
      // Cascade had already declared dead. A 0-row update means the
      // row left `queued` — skip the spawn and free the slot so drain
      // moves on.
      const startedAt = new Date();
      const claimed = await prisma.dispatch.updateMany({
        where: { id: dispatch.id, status: "queued" },
        data: {
          status: "started",
          startedAt,
          // Re-anchor the watchdog deadline at ACTUAL start. Anchoring
          // at enqueue let queue wait time eat the run window, so slow
          // queues produced instant "timeouts" on healthy sessions.
          expectedBy: new Date(
            startedAt.getTime() + (spec.expectedByMs ?? DEFAULT_EXPECTED_BY_MS)
          ),
        },
      });
      if (claimed.count === 0) {
        getDispatchQueue().release(dispatch.idempotencyKey);
        return;
      }
      try {
        await spec.spawnFn(dispatch.idempotencyKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.dispatch.update({
          where: { id: dispatch.id },
          data: {
            status: "failed",
            errorMessage: message,
            completedAt: new Date(),
          },
        });
        throw err;
      }
    },
  });

  return { idempotencyKey: dispatch.idempotencyKey, dispatchId: dispatch.id };
}
