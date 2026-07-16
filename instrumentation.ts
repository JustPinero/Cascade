/**
 * Phase 35 — Next.js server-boot hook. Closes [23.D5].
 *
 * `register()` is called exactly once when the Next.js Node server
 * starts (both `next dev` and `next start`). This is the canonical
 * place to start long-running background tasks. The Edge runtime
 * doesn't run our DB code, so we gate on `NEXT_RUNTIME === "nodejs"`.
 *
 * The dispatch watchdog runs every 5 minutes in-process. Without this,
 * hung Dispatch rows past their `expectedBy` deadline hold queue slots
 * until the dev server restarts.
 *
 * Phase 41.5 — also drains the webhook spool at boot + on an interval,
 * replaying Stop-hook pings that were spooled while the server (or `op`)
 * was down. Boot is exactly when the server is back UP, so draining
 * there recovers the pings that would otherwise vanish.
 *
 * Fix 41.D9 — self-heal the canonical Stop-hook script at boot: copy
 * scripts/session-complete-hook.sh to the $HOME-stable location the
 * committed hooks reference (~/.cascade/session-complete-hook.sh). A
 * freshly-cloned machine gets a working hook even before install-hooks
 * is re-run. Wrapped so a copy failure never crashes server startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Phase 42 (P0.5) — put dev.db in WAL mode before anything else touches
  // it. Persistent once applied; synchronous=NORMAL re-applies per boot.
  const { applySqlitePragmas } = await import("@/lib/db-pragmas");
  const { prisma } = await import("@/lib/db");
  await applySqlitePragmas(prisma);
  const { startDispatchWatchdog } = await import(
    "@/lib/dispatch-watchdog-runtime"
  );
  startDispatchWatchdog();
  const { startSpoolDrain } = await import("@/lib/webhook-spool-runtime");
  startSpoolDrain();
  try {
    const { copyCanonicalScript } = await import("@/scripts/install-hooks");
    copyCanonicalScript();
  } catch (err) {
    console.error(
      `[install-hooks] canonical hook self-heal failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
