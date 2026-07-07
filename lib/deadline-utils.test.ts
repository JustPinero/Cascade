import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatCountdown, isOverdue, getDeadlineUrgency } from "./deadline-utils";

describe("deadline-utils", () => {
  // Freeze the clock: these tests build deadlines relative to Date.now()
  // and the implementation calls Date.now() again — with real timers the
  // milliseconds elapsed in between trip Math.floor at exact-day
  // boundaries (flaked under full-suite load in phase 41.3 validation).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatCountdown", () => {
    it("returns '3d left' for 3 days out", () => {
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      expect(formatCountdown(future)).toBe("3d left");
    });

    it("returns 'due today' for today", () => {
      const today = new Date();
      today.setHours(23, 59, 59);
      expect(formatCountdown(today)).toBe("due today");
    });

    it("returns '2d overdue' for 2 days past", () => {
      const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(formatCountdown(past)).toBe("2d overdue");
    });

    it("returns null for null deadline", () => {
      expect(formatCountdown(null)).toBeNull();
    });
  });

  describe("isOverdue", () => {
    it("returns true for past dates", () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(isOverdue(past)).toBe(true);
    });

    it("returns false for future dates", () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(isOverdue(future)).toBe(false);
    });

    it("returns false for null", () => {
      expect(isOverdue(null)).toBe(false);
    });
  });

  describe("getDeadlineUrgency", () => {
    it("returns none for null deadline", () => {
      expect(getDeadlineUrgency(null)).toBe("none");
    });

    it("returns overdue for past deadlines", () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(getDeadlineUrgency(past)).toBe("overdue");
    });

    it("returns urgent for within 3 days", () => {
      const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      expect(getDeadlineUrgency(soon)).toBe("urgent");
    });

    it("returns normal for more than 3 days", () => {
      const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      expect(getDeadlineUrgency(later)).toBe("normal");
    });
  });
});
