/**
 * Phase 24.1 — heuristic summary tests.
 */
import { describe, it, expect } from "vitest";
import { generateSummary } from "./overseer-history-summary";

function emptyByMode() {
  return {} as Parameters<typeof generateSummary>[0]["byMode"];
}

describe("generateSummary", () => {
  it("returns empty string when totalDispatches is below the floor", () => {
    expect(
      generateSummary({
        byMode: emptyByMode(),
        recentTimeline: [],
        totalDispatches: 1,
      })
    ).toBe("");
  });

  it("flags 3+ consecutive empty-signal audits", () => {
    const result = generateSummary({
      byMode: {
        audit: { count: 3, successRate: 1, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 3,
    });
    expect(result).toContain("3 of last 3 audits returned no actionable signals");
  });

  it("does NOT flag empty-signal audits when count is below threshold", () => {
    const result = generateSummary({
      byMode: {
        audit: { count: 2, successRate: 1, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 2,
    });
    expect(result).not.toContain("audits returned no actionable signals");
  });

  it("flags consistent continue success at >=70% over 3+ runs", () => {
    const result = generateSummary({
      byMode: {
        continue: { count: 5, successRate: 0.8, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 5,
    });
    expect(result).toContain("80% of recent continues (5) succeeded");
  });

  it("flags continue mode failing at <=30% over 2+ runs", () => {
    const result = generateSummary({
      byMode: {
        continue: { count: 4, successRate: 0.25, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 4,
    });
    expect(result).toMatch(/Continue mode has been failing/);
    expect(result).toContain("25% success");
  });

  it("does NOT flag continue success when count is too low", () => {
    const result = generateSummary({
      byMode: {
        continue: { count: 2, successRate: 1, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 2,
    });
    expect(result).not.toContain("succeeded");
  });

  it("surfaces recurring signals across modes", () => {
    const result = generateSummary({
      byMode: {
        audit: {
          count: 3,
          successRate: 0,
          recurringSignals: ["needs-attention"],
        },
      },
      recentTimeline: [],
      totalDispatches: 3,
    });
    expect(result).toContain("Recurring signals");
    expect(result).toContain("audit: needs-attention");
  });

  it("returns multi-clause summary when several conditions trigger", () => {
    const result = generateSummary({
      byMode: {
        audit: { count: 3, successRate: 1, recurringSignals: [] },
        continue: { count: 5, successRate: 0.8, recurringSignals: [] },
      },
      recentTimeline: [],
      totalDispatches: 8,
    });
    expect(result).toContain("audits returned no actionable signals");
    expect(result).toContain("continues (5) succeeded");
  });
});
