/**
 * Phase 21.1 — silence detector. Wraps the "fire after N ms of
 * silence" pattern Conversation Mode uses to auto-submit after the
 * user stops speaking.
 *
 * Usage:
 *   const det = createSilenceDetector(1500, () => sendMessage());
 *   onInterim: det.reset();   // each transcript fragment restarts the clock
 *   onStopMic: det.stop();    // teardown
 *
 * Pure timer state-machine — no DOM, no browser API. Easy to test
 * with `vi.useFakeTimers()`.
 */

export interface SilenceDetector {
  /** Restart the silence timer. Optional override of the threshold. */
  reset(newThresholdMs?: number): void;
  /** Cancel any pending callback. Detector can be reset again afterward. */
  stop(): void;
}

export function createSilenceDetector(
  thresholdMs: number,
  onSilence: () => void
): SilenceDetector {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentThreshold = thresholdMs;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    reset(newThresholdMs?: number): void {
      if (typeof newThresholdMs === "number" && newThresholdMs > 0) {
        currentThreshold = newThresholdMs;
      }
      clear();
      timer = setTimeout(() => {
        timer = null;
        onSilence();
      }, currentThreshold);
    },
    stop(): void {
      clear();
    },
  };
}
