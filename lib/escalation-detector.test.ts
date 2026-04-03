import { describe, it, expect } from "vitest";
import { detectEscalations } from "./escalation-detector";

describe("detectEscalations", () => {
  it("detects [NEEDS ATTENTION] tag", () => {
    const content = `# Session Handoff
Date: 2026-04-03

## Status
Hit a CORS issue.

[NEEDS ATTENTION] CORS headers not being set correctly in middleware.
`;
    const signals = detectEscalations(content);
    expect(signals).toContainEqual(
      expect.objectContaining({
        type: "needs-attention",
        message: expect.stringContaining("CORS"),
      })
    );
  });

  it("detects [LESSON] tags", () => {
    const content = `# Session Handoff

## Work Completed
Fixed the auth middleware.

[LESSON] Always check CSP headers when using Clerk with Vercel — they strip custom headers by default.
`;
    const signals = detectEscalations(content);
    expect(signals).toContainEqual(
      expect.objectContaining({
        type: "lesson",
        message: expect.stringContaining("CSP headers"),
      })
    );
  });

  it("detects multiple [LESSON] tags", () => {
    const content = `# Handoff

[LESSON] Prisma needs db push after schema changes.
[LESSON] Always seed after migration.
`;
    const signals = detectEscalations(content);
    const lessons = signals.filter((s) => s.type === "lesson");
    expect(lessons).toHaveLength(2);
  });

  it("detects test failure mentions", () => {
    const content = `# Session Handoff

## Status
3 tests failing in auth module.
Ran pnpm test — 42 passed, 3 failed.
`;
    const signals = detectEscalations(content);
    expect(signals).toContainEqual(
      expect.objectContaining({
        type: "test-failure",
      })
    );
  });

  it("detects phase completion", () => {
    const content = `# Session Handoff

## Work Completed
Phase 2 complete. All requests done, tests passing.
Moving to phase 3.
`;
    const signals = detectEscalations(content);
    expect(signals).toContainEqual(
      expect.objectContaining({
        type: "phase-complete",
      })
    );
  });

  it("returns empty array for clean session with no signals", () => {
    const content = `# Session Handoff

## Work Completed
Continued working on request 2.3. Tests passing. No issues.
`;
    const signals = detectEscalations(content);
    expect(signals).toEqual([]);
  });

  it("detects multiple signal types in one session", () => {
    const content = `# Handoff

Phase 1 complete.

[LESSON] Always run prisma generate after schema changes.

[NEEDS ATTENTION] Can't figure out the webhook signature verification.
`;
    const signals = detectEscalations(content);
    expect(signals.length).toBeGreaterThanOrEqual(3);
    const types = signals.map((s) => s.type);
    expect(types).toContain("phase-complete");
    expect(types).toContain("lesson");
    expect(types).toContain("needs-attention");
  });

  it("handles empty content", () => {
    expect(detectEscalations("")).toEqual([]);
  });
});
