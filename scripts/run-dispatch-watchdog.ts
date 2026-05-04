/**
 * Phase 23 follow-up P0.1 — startup + recurring dispatch watchdog.
 *
 * Flips Dispatch rows past their `expectedBy` deadline to "timeout"
 * and releases their queue slots. Without this, hung dispatches hold
 * queue slots indefinitely until process restart.
 *
 * Wired into scripts/start.sh next to the team-stall scan. Runs once
 * at startup. For long-running deployments, schedule this on a tick
 * (cron or dispatch-queue) every 5 minutes — once-at-startup is fine
 * for local dev where pnpm dev restarts often.
 *
 * Best-effort; never blocks startup.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

import { prisma } from "@/lib/db";
import { getDispatchQueue } from "@/lib/dispatch-queue";
import { runDispatchWatchdog } from "@/lib/dispatch-watchdog";

async function main(): Promise<void> {
  try {
    const result = await runDispatchWatchdog(prisma, getDispatchQueue());
    if (result.timedOut > 0) {
      console.log(
        `[dispatch-watchdog] flipped ${result.timedOut} dispatch(es) to timeout: ${result.keys.slice(0, 5).join(", ")}${result.keys.length > 5 ? ", …" : ""}`
      );
    }
  } catch (err) {
    console.error(
      `[dispatch-watchdog] failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
