/**
 * Phase 40 [P3] — outcome-driven dispatch recommendations engine.
 *
 * Pure heuristic, same spirit as overseer-history-summary: deterministic,
 * no model call. These tests are the contract for the recommendation rules
 * (AC1–AC6 in the phase plan).
 */
import { describe, it, expect } from "vitest";
import {
  computeRecommendations,
  successWeight,
  type ProjectOutcomes,
  type OutcomeRow,
} from "./dispatch-recommendations";

/** Build N outcome rows for one mode with a fixed outcome + signals. */
function rows(
  mode: string,
  outcome: string,
  count: number,
  signals: string[] = []
): ProjectOutcomes["outcomes"] {
  return Array.from({ length: count }, () => ({ mode, outcome, signals }));
}

describe("computeRecommendations", () => {
  it("AC1: returns no recommendations for empty input", () => {
    expect(computeRecommendations([])).toEqual([]);
    expect(
      computeRecommendations([{ slug: "alpha", outcomes: [] }])
    ).toEqual([]);
  });

  it("AC2: flags a diagnostic mode that keeps coming back clean", () => {
    const recs = computeRecommendations([
      { slug: "medipal", outcomes: rows("audit", "success", 4) },
    ]);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    expect(rec.kind).toBe("low-signal-mode");
    expect(rec.projectSlug).toBe("medipal");
    expect(rec.mode).toBe("audit");
    expect(rec.suggestedMode).toBe("continue");
    expect(rec.severity).toBe("info");
    expect(rec.count).toBe(4);
    // Message names the project, the count, and "0 findings".
    expect(rec.message).toContain("medipal");
    expect(rec.message).toContain("4");
    expect(rec.message).toContain("0 findings");
  });

  it("AC2b: low-signal rule also applies to investigate mode", () => {
    const recs = computeRecommendations([
      { slug: "beta", outcomes: rows("investigate", "success", 3) },
    ]);
    expect(recs).toHaveLength(1);
    expect(recs[0].kind).toBe("low-signal-mode");
    expect(recs[0].mode).toBe("investigate");
    expect(recs[0].suggestedMode).toBe("continue");
  });

  it("AC3: does not flag low-signal below the repeat threshold", () => {
    const recs = computeRecommendations([
      { slug: "alpha", outcomes: rows("audit", "success", 2) },
    ]);
    expect(recs).toEqual([]);
  });

  it("AC3b: does not flag low-signal when the mode IS finding things", () => {
    // 3 audits but every one carries a recurring signal — it's earning its keep.
    const recs = computeRecommendations([
      {
        slug: "alpha",
        outcomes: rows("audit", "attention-needed", 3, ["needs-attention"]),
      },
    ]);
    expect(recs.some((r) => r.kind === "low-signal-mode")).toBe(false);
  });

  it("AC4: flags a continue mode that keeps failing", () => {
    // 1 success out of 4 = 25% <= 30%.
    const outcomes = [
      ...rows("continue", "success", 1),
      ...rows("continue", "blocker", 3, ["human-todo"]),
    ];
    const recs = computeRecommendations([{ slug: "gamma", outcomes }]);
    const failing = recs.find((r) => r.kind === "failing-mode");
    expect(failing).toBeDefined();
    expect(failing!.mode).toBe("continue");
    expect(failing!.suggestedMode).toBe("investigate");
    expect(failing!.severity).toBe("warn");
    expect(failing!.count).toBe(4);
    expect(failing!.message).toContain("gamma");
  });

  it("AC4b: does not flag continue when it is succeeding", () => {
    const recs = computeRecommendations([
      { slug: "delta", outcomes: rows("continue", "success", 3) },
    ]);
    expect(recs.some((r) => r.kind === "failing-mode")).toBe(false);
  });

  it("AC4c: does not flag a single failing continue (below min count)", () => {
    const recs = computeRecommendations([
      { slug: "delta", outcomes: rows("continue", "blocker", 1) },
    ]);
    expect(recs.some((r) => r.kind === "failing-mode")).toBe(false);
  });

  it("AC5: surfaces a recurring blocker-class signal", () => {
    // needs-attention in 3 of 4 continue outcomes = 75% >= 50%.
    const outcomes = [
      ...rows("continue", "attention-needed", 3, ["needs-attention"]),
      ...rows("continue", "success", 1),
    ];
    const recs = computeRecommendations([{ slug: "epsilon", outcomes }]);
    const blocker = recs.find((r) => r.kind === "recurring-blocker");
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe("warn");
    expect(blocker!.suggestedMode).toBeUndefined();
    expect(blocker!.message).toContain("needs-attention");
    expect(blocker!.message).toContain("epsilon");
  });

  it("AC5b: ignores non-blocker recurring signals", () => {
    // A recurring but non-blocker-class signal should not raise the alarm.
    const outcomes = rows("continue", "success", 4, ["lesson"]);
    const recs = computeRecommendations([{ slug: "zeta", outcomes }]);
    expect(recs.some((r) => r.kind === "recurring-blocker")).toBe(false);
  });

  // Phase 41.2 — goal-verified outcomes outrank self-reported ones.
  it("41.2: successWeight ranks goal-verified above self-reported above contradicted", () => {
    const base: Omit<OutcomeRow, "goalAchieved"> = {
      mode: "continue",
      outcome: "success",
      signals: [],
    };
    const verified = successWeight({ ...base, goalAchieved: true });
    const selfReported = successWeight({ ...base });
    const contradicted = successWeight({ ...base, goalAchieved: false });
    expect(verified).toBeGreaterThan(selfReported);
    expect(selfReported).toBeGreaterThan(contradicted);
    expect(contradicted).toBe(0);
    expect(successWeight({ ...base, outcome: "blocker" })).toBe(0);
  });

  it("41.2: goal-verified successes keep a struggling continue off the failing list where self-reported ones do not", () => {
    const failures = rows("continue", "blocker", 3, ["human-todo"]);
    const verifiedSuccess: OutcomeRow[] = Array.from({ length: 2 }, () => ({
      mode: "continue",
      outcome: "success",
      signals: [],
      goalAchieved: true,
    }));
    const selfReportedSuccess = rows("continue", "success", 2);

    const recs = computeRecommendations([
      { slug: "verified", outcomes: [...verifiedSuccess, ...failures] },
      { slug: "self-reported", outcomes: [...selfReportedSuccess, ...failures] },
    ]);

    const failing = recs.filter((r) => r.kind === "failing-mode");
    // Same raw shape (2 successes / 3 blockers) — only the goal-verified
    // project earns the benefit of the doubt.
    expect(failing.map((r) => r.projectSlug)).toEqual(["self-reported"]);
  });

  it("41.2: successes contradicted by the goal evaluator count as failures", () => {
    const contradicted: OutcomeRow[] = Array.from({ length: 3 }, () => ({
      mode: "continue",
      outcome: "success",
      signals: [],
      goalAchieved: false,
    }));
    const recs = computeRecommendations([
      { slug: "liar", outcomes: contradicted },
    ]);
    const failing = recs.find((r) => r.kind === "failing-mode");
    expect(failing).toBeDefined();
    expect(failing!.projectSlug).toBe("liar");
  });

  it("AC6: produces recommendations independently per project", () => {
    const recs = computeRecommendations([
      { slug: "one", outcomes: rows("audit", "success", 3) },
      { slug: "two", outcomes: rows("continue", "success", 3) },
      {
        slug: "three",
        outcomes: [
          ...rows("continue", "success", 1),
          ...rows("continue", "blocker", 3),
        ],
      },
    ]);
    const slugs = recs.map((r) => r.projectSlug);
    expect(slugs).toContain("one"); // low-signal audit
    expect(slugs).toContain("three"); // failing continue
    expect(slugs).not.toContain("two"); // healthy — nothing to say
  });
});
