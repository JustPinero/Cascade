/**
 * Phase 21.1 — silence-detector helper. Pure timer state-machine
 * for "fire callback when silent for N ms." Used by Conversation
 * Mode to auto-submit after the user stops speaking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSilenceDetector } from "@/lib/silence-detector";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSilenceDetector", () => {
  it("fires the callback after thresholdMs of silence", () => {
    const cb = vi.fn();
    const det = createSilenceDetector(1500, cb);

    det.reset();
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1499);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);

    expect(typeof det).toBe("object");
  });

  it("fires only once even if reset() is called many times before expiry", () => {
    const cb = vi.fn();
    const det = createSilenceDetector(1000, cb);

    det.reset();
    vi.advanceTimersByTime(500);
    det.reset(); // restart the clock
    vi.advanceTimersByTime(500);
    det.reset(); // restart again
    vi.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire if stop() is called before the timer expires", () => {
    const cb = vi.fn();
    const det = createSilenceDetector(1000, cb);

    det.reset();
    vi.advanceTimersByTime(500);
    det.stop();
    vi.advanceTimersByTime(2000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("can be re-armed after stop() and fires correctly the second time", () => {
    const cb = vi.fn();
    const det = createSilenceDetector(1000, cb);

    det.reset();
    det.stop();
    expect(cb).not.toHaveBeenCalled();

    det.reset();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("supports updating the threshold mid-session via reset(newMs)", () => {
    const cb = vi.fn();
    const det = createSilenceDetector(1000, cb);

    det.reset();
    vi.advanceTimersByTime(500);
    det.reset(2000); // user moved the slider; full 2000ms restarts here
    vi.advanceTimersByTime(1999);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the callback if reset is never called", () => {
    const cb = vi.fn();
    createSilenceDetector(500, cb);
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });
});
