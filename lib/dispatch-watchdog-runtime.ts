/**
 * Phase 35 — runtime hook for the dispatch watchdog. Closes [23.D5].
 *
 * The watchdog (`lib/dispatch-watchdog.ts`) flips Dispatch rows past
 * their `expectedBy` deadline to "timeout" and releases queue slots.
 * Before this module, the watchdog only fired through `scripts/run-
 * dispatch-watchdog.ts` — invoked from `scripts/start.sh`, which
 * Justin doesn't use day-to-day. `pnpm dev` never triggered it, so
 * hung dispatches held queue slots until process restart.
 *
 * This module is imported by Next.js's `instrumentation.ts` register
 * hook, which fires once at server boot. It schedules an in-process
 * interval that runs the watchdog every 5 minutes.
 *
 * Single-instance guarantees:
 * - `globalThis` key prevents duplicate timers across HMR re-imports.
 * - NODE_ENV === "test" is a no-op unless `{force:true}` is passed
 *   (vitest fake-timer tests explicitly opt in via force).
 *
 * The tick swallows errors and logs to console — never let an interval
 * crash the dev server because of a transient DB failure.
 */
import { prisma } from "./db";
import {
  runDispatchWatchdog,
  reconcileOrphanedDispatches,
} from "./dispatch-watchdog";
import { getDispatchQueue } from "./dispatch-queue";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const GLOBAL_KEY = "__cascadeDispatchWatchdogTimer";

interface GlobalWithWatchdog {
  [GLOBAL_KEY]?: NodeJS.Timeout;
}

function globalSlot(): GlobalWithWatchdog {
  return globalThis as unknown as GlobalWithWatchdog;
}

export interface StartWatchdogOptions {
  /** Override the 5-minute default. Tests use sub-second values. */
  intervalMs?: number;
  /** Bypass the NODE_ENV === "test" guard (test-only). */
  force?: boolean;
}

export function startDispatchWatchdog(
  opts: StartWatchdogOptions = {}
): void {
  if (process.env.NODE_ENV === "test" && !opts.force) return;
  const slot = globalSlot();
  if (slot[GLOBAL_KEY]) return;

  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Phase 37 [36.A2] — reconcile rows orphaned by the previous process
  // once at boot, then fire an immediate tick so a freshly-booted
  // server also cleans up expired rows. Then the recurring tick.
  void (async () => {
    await reconcileAtBoot();
    await tick();
  })();
  slot[GLOBAL_KEY] = setInterval(() => void tick(), intervalMs);
}

async function reconcileAtBoot(): Promise<void> {
  try {
    const result = await reconcileOrphanedDispatches(prisma);
    if (result.orphaned > 0) {
      console.log(
        `[dispatch-watchdog] failed ${result.orphaned} dispatch(es) orphaned by restart: ${result.keys
          .slice(0, 5)
          .join(", ")}${result.keys.length > 5 ? ", …" : ""}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dispatch-watchdog] boot reconciliation failed: ${message}`);
  }
}

async function tick(): Promise<void> {
  try {
    const result = await runDispatchWatchdog(prisma, getDispatchQueue());
    if (result.timedOut > 0) {
      const sample = result.keys.slice(0, 5).join(", ");
      const more = result.keys.length > 5 ? ", …" : "";
      console.log(
        `[dispatch-watchdog] flipped ${result.timedOut} dispatch(es) to timeout: ${sample}${more}`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dispatch-watchdog] tick failed: ${message}`);
  }
}

/** Test-only — clear the singleton timer between tests. */
export function __stopDispatchWatchdogForTests(): void {
  const slot = globalSlot();
  if (slot[GLOBAL_KEY]) {
    clearInterval(slot[GLOBAL_KEY]);
    slot[GLOBAL_KEY] = undefined;
  }
}

/** Test-only — assert the singleton is or isn't running. */
export function __isDispatchWatchdogRunningForTests(): boolean {
  return !!globalSlot()[GLOBAL_KEY];
}
