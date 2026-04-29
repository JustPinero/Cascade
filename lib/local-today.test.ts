import { describe, it, expect, vi, afterEach } from "vitest";
import { localToday } from "@/lib/local-today";

afterEach(() => {
  vi.useRealTimers();
});

describe("localToday", () => {
  it("returns YYYY-MM-DD shape", () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the user's local date in their timezone", () => {
    // Mock "now" to a moment that's a different date in different TZs.
    // 2026-04-29T03:30:00Z is 23:30 EDT on April 28 — different days.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T03:30:00Z"));

    expect(localToday({ timeZone: "America/New_York" })).toBe("2026-04-28");
    expect(localToday({ timeZone: "UTC" })).toBe("2026-04-29");
    expect(localToday({ timeZone: "Asia/Tokyo" })).toBe("2026-04-29");
  });

  it("zero-pads single-digit months and days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
    expect(localToday({ timeZone: "UTC" })).toBe("2026-01-05");
  });

  it("handles DST transition without skipping a day (fall-back)", () => {
    // 2026-11-01 in America/New_York is the fall-back day (25-hour day).
    // Three points across that day should all return 2026-11-01.
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-11-01T05:30:00Z")); // 1:30am EDT
    expect(localToday({ timeZone: "America/New_York" })).toBe("2026-11-01");

    vi.setSystemTime(new Date("2026-11-01T08:30:00Z")); // 3:30am EST (post fall-back)
    expect(localToday({ timeZone: "America/New_York" })).toBe("2026-11-01");

    vi.setSystemTime(new Date("2026-11-01T16:00:00Z")); // 11:00am EST
    expect(localToday({ timeZone: "America/New_York" })).toBe("2026-11-01");
  });
});
