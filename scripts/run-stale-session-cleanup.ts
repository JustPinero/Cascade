/**
 * Phase 15 — startup hook that closes ChatSessions whose startedAt is
 * older than 30 days. Best-effort; never blocks startup.
 *
 * Wired into scripts/start.sh next to the version watcher. Without
 * this, the `closedAt = null = active` invariant is purely
 * aspirational and rows accumulate forever.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

import { prisma } from "@/lib/db";
import { closeStaleSessions } from "@/lib/chat-session";

const STALE_AFTER_DAYS = 30;

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  try {
    const result = await closeStaleSessions(prisma, cutoff);
    if (result.closed > 0) {
      console.log(
        `[stale-session-cleanup] closed ${result.closed} sessions older than ${STALE_AFTER_DAYS} days`
      );
    }
  } catch (err) {
    console.warn(
      `[stale-session-cleanup] error (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
