import { describe, it, expect } from "vitest";
import { getCompletionDisplay } from "@/lib/project-display";

describe("getCompletionDisplay", () => {
  it("returns shipped+Deployed for status: deployed regardless of score", () => {
    const out = getCompletionDisplay({ status: "deployed", progressScore: 46 });
    expect(out).toEqual({ kind: "shipped", label: "Deployed", score: 46 });
  });

  it("returns shipped+Complete for status: complete regardless of score", () => {
    const out = getCompletionDisplay({ status: "complete", progressScore: 14 });
    expect(out).toEqual({ kind: "shipped", label: "Complete", score: 14 });
  });

  it("returns in-progress for status: building", () => {
    const out = getCompletionDisplay({ status: "building", progressScore: 60 });
    expect(out).toEqual({ kind: "in-progress", score: 60 });
  });

  it("returns in-progress for status: backburner", () => {
    const out = getCompletionDisplay({
      status: "backburner",
      progressScore: 30,
    });
    expect(out).toEqual({ kind: "in-progress", score: 30 });
  });

  it("returns in-progress for status: paused", () => {
    const out = getCompletionDisplay({ status: "paused", progressScore: 0 });
    expect(out).toEqual({ kind: "in-progress", score: 0 });
  });

  it("returns in-progress for status: archived", () => {
    const out = getCompletionDisplay({ status: "archived", progressScore: 99 });
    expect(out).toEqual({ kind: "in-progress", score: 99 });
  });

  it("treats missing progressScore as 0", () => {
    const out = getCompletionDisplay({ status: "building" });
    expect(out).toEqual({ kind: "in-progress", score: 0 });
  });

  it("clamps the score in returned shipped output (transparency, but bounded)", () => {
    const out = getCompletionDisplay({
      status: "deployed",
      progressScore: 150,
    });
    if (out.kind === "shipped") {
      expect(out.score).toBe(100);
    }
  });
});
