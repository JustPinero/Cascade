/**
 * Phase 42 (P0.4) — propagate client disconnects into an AbortController.
 *
 * The chat route's tool loop was bounded only by its 60s wall timer;
 * `request.signal` was never wired, so a closed tab kept burning up to
 * 8 streaming Sonnet calls (plus the Haiku summarizer) with the output
 * discarded. Linking the request signal aborts the loop the moment the
 * client goes away.
 */
export function linkAbort(source: AbortSignal, target: AbortController): void {
  if (source.aborted) {
    target.abort();
    return;
  }
  source.addEventListener("abort", () => target.abort(), { once: true });
}
