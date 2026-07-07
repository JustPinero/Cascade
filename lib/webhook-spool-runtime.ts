/**
 * Phase 41.5 — runtime hook for the webhook spool drain.
 *
 * The drain (`lib/webhook-spool.ts`) replays Stop-hook pings that were
 * spooled while Cascade was unreachable. This module is imported by
 * Next.js's `instrumentation.ts` register hook (fires once at server
 * boot). It drains immediately at boot — the common case, since the
 * server being back UP is exactly when spooled entries can be
 * replayed — then schedules an in-process interval.
 *
 * Single-instance guarantees:
 * - `globalThis` key prevents duplicate timers across HMR re-imports.
 * - NODE_ENV === "test" is a no-op unless `{force:true}` is passed.
 *
 * The tick swallows errors and logs — never let an interval crash the
 * dev server because of a transient FS/DB failure.
 */
import { prisma } from "./db";
import { drainWebhookSpool } from "./webhook-spool";

const DEFAULT_INTERVAL_MS = 60 * 1000;
const GLOBAL_KEY = "__cascadeWebhookSpoolTimer";

interface GlobalWithSpool {
  [GLOBAL_KEY]?: NodeJS.Timeout;
}

function globalSlot(): GlobalWithSpool {
  return globalThis as unknown as GlobalWithSpool;
}

export interface StartSpoolDrainOptions {
  /** Override the 60-second default. Tests use sub-second values. */
  intervalMs?: number;
  /** Bypass the NODE_ENV === "test" guard (test-only). */
  force?: boolean;
}

export function startSpoolDrain(opts: StartSpoolDrainOptions = {}): void {
  if (process.env.NODE_ENV === "test" && !opts.force) return;
  const slot = globalSlot();
  if (slot[GLOBAL_KEY]) return;

  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Fire an immediate drain at boot, then the recurring tick.
  void tick();
  slot[GLOBAL_KEY] = setInterval(() => void tick(), intervalMs);
}

async function tick(): Promise<void> {
  try {
    const result = await drainWebhookSpool(prisma);
    if (result.ingested > 0 || result.skipped > 0) {
      console.log(
        `[webhook-spool] drained ${result.ingested} entr${
          result.ingested === 1 ? "y" : "ies"
        }${result.skipped > 0 ? `, skipped ${result.skipped}` : ""}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook-spool] drain tick failed: ${message}`);
  }
}

/** Test-only — clear the singleton timer between tests. */
export function __stopSpoolDrainForTests(): void {
  const slot = globalSlot();
  if (slot[GLOBAL_KEY]) {
    clearInterval(slot[GLOBAL_KEY]);
    slot[GLOBAL_KEY] = undefined;
  }
}

/** Test-only — assert the singleton is or isn't running. */
export function __isSpoolDrainRunningForTests(): boolean {
  return !!globalSlot()[GLOBAL_KEY];
}
