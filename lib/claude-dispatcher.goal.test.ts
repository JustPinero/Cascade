/**
 * Phase 41.2 — /goal line in composed dispatch prompts.
 *
 * AC1: given a request file fixture, the composed continue prompt
 *      opens with a /goal line naming the criteria + validate.sh with
 *      transcript-visible checks.
 * AC2: the composed condition contains the turn bound.
 * AC3: dispatches without a request file (ad-hoc) skip /goal cleanly —
 *      no /goal line, no crash.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generatePrompt } from "./claude-dispatcher";
import fs from "fs/promises";
import path from "path";

const TEST_DIR = path.resolve(__dirname, "../.test-dispatcher-goal");

const REQUEST_WITH_CRITERIA = `# Request 9.1 — Search

## Acceptance Criteria → Test Mapping

| Criterion | Test |
|-----------|------|
| Search returns matching projects by slug | unit: query "med" returns medipal |
| Empty query returns 400 | unit: GET /api/search?q= → 400 |
`;

describe("generatePrompt — goal-driven dispatch (Phase 41.2)", () => {
  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, "requests", "phase-9-search"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(TEST_DIR, "requests", "phase-9-search", "9.1-search.md"),
      REQUEST_WITH_CRITERIA
    );
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("AC1: continue prompt opens with a /goal line composed from the request's criteria", async () => {
    const prompt = await generatePrompt(TEST_DIR, "continue");
    expect(prompt.startsWith("/goal ")).toBe(true);

    const goalLine = prompt.split("\n")[0];
    // Names the criteria…
    expect(goalLine).toContain("Search returns matching projects by slug");
    // …and the transcript-visible validate.sh check.
    expect(goalLine).toContain("scripts/validate.sh exits 0");
    expect(goalLine).toMatch(/shown by running it/i);
  });

  it("AC2: the composed condition contains the turn bound", async () => {
    const prompt = await generatePrompt(TEST_DIR, "continue");
    const goalLine = prompt.split("\n")[0];
    expect(goalLine).toMatch(/stop after \d+ turns/i);
  });

  it("AC1: the rest of the continue prompt is intact below the goal line", async () => {
    const prompt = await generatePrompt(TEST_DIR, "continue");
    expect(prompt).toContain("Read CLAUDE.md");
    expect(prompt).toContain("action loop");
  });

  it("AC3: custom (ad-hoc) dispatches skip /goal cleanly", async () => {
    const prompt = await generatePrompt(TEST_DIR, "custom", "Fix the login bug");
    expect(prompt).toContain("Fix the login bug");
    expect(prompt).not.toContain("/goal");
  });

  it("AC3: audit and investigate modes carry no /goal line", async () => {
    for (const mode of ["audit", "investigate"] as const) {
      const prompt = await generatePrompt(TEST_DIR, mode);
      expect(prompt).not.toContain("/goal");
    }
  });

  it("AC3: continue without any request file skips /goal and does not crash", async () => {
    const emptyDir = path.join(TEST_DIR, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    const prompt = await generatePrompt(emptyDir, "continue");
    expect(prompt).toContain("Read CLAUDE.md");
    expect(prompt).not.toContain("/goal");
  });

  it("AC3: a request file without acceptance criteria skips /goal and does not crash", async () => {
    const noCriteriaDir = path.join(TEST_DIR, "no-criteria");
    await fs.mkdir(path.join(noCriteriaDir, "requests", "phase-1-x"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(noCriteriaDir, "requests", "phase-1-x", "1.1-x.md"),
      "# Request 1.1\n\nJust prose, no criteria section.\n"
    );
    const prompt = await generatePrompt(noCriteriaDir, "continue");
    expect(prompt).toContain("Read CLAUDE.md");
    expect(prompt).not.toContain("/goal");
  });
});
