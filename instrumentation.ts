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
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDispatchWatchdog } = await import(
    "@/lib/dispatch-watchdog-runtime"
  );
  startDispatchWatchdog();
  const { startSpoolDrain } = await import("@/lib/webhook-spool-runtime");
  startSpoolDrain();
}
