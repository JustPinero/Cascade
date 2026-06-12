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
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDispatchWatchdog } = await import(
    "@/lib/dispatch-watchdog-runtime"
  );
  startDispatchWatchdog();
}
