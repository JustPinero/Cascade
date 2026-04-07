import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

// We test the artifact gathering indirectly by importing the module
// and checking it doesn't crash on various project structures.
// The Claude API call is tested via integration, not unit tests.

const TEST_DIR = path.resolve(__dirname, "../.test-retro-harvest");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("retroactive-harvester module", () => {
  it("exports retroHarvestProject and retroHarvestAll", async () => {
    const mod = await import("./retroactive-harvester");
    expect(typeof mod.retroHarvestProject).toBe("function");
    expect(typeof mod.retroHarvestAll).toBe("function");
  });

  it("handles project with no artifacts gracefully", async () => {
    const dir = path.join(TEST_DIR, "empty-project");
    await fs.mkdir(dir, { recursive: true });

    const mod = await import("./retroactive-harvester");

    // Mock prisma and apiKey — we expect it to fail gracefully
    // since there are no artifacts to send to Claude
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Empty Project",
      "empty-project",
      "sk-fake-key"
    );

    expect(result.projectName).toBe("Empty Project");
    expect(result.artifactsGathered).toBe(0);
    expect(result.error).toBe("No historical artifacts found");
  });

  it("gathers git history from a project with commits", async () => {
    const dir = path.join(TEST_DIR, "git-project");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), "# Test");

    execSync("git init && git add -A && git commit -m 'init'", {
      cwd: dir,
      stdio: "pipe",
    });
    // Add a fix commit
    await fs.writeFile(path.join(dir, "fix.txt"), "fixed");
    execSync("git add -A && git commit -m 'fix: resolved auth bug'", {
      cwd: dir,
      stdio: "pipe",
    });

    const mod = await import("./retroactive-harvester");
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Git Project",
      "git-project",
      "sk-fake-key"
    );

    // Should have gathered at least git log artifact
    expect(result.artifactsGathered).toBeGreaterThanOrEqual(1);
    // Will fail on Claude API call since key is fake, but artifacts were gathered
    expect(result.error).toBeTruthy(); // Claude API error expected
  });

  it("gathers multiple artifact types", async () => {
    const dir = path.join(TEST_DIR, "full-project");
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    await fs.mkdir(path.join(dir, "audits"), { recursive: true });

    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Standards\nAlways use strict mode.");
    await fs.writeFile(
      path.join(dir, ".claude", "handoff.md"),
      "# Handoff\nCompleted phase 1."
    );
    await fs.writeFile(
      path.join(dir, "audits", "debt.md"),
      "# Debt\n\n## Open\n\n## Resolved\n- Fixed CORS issue\n- Resolved auth token bug\n"
    );

    execSync("git init && git add -A && git commit -m 'fix: initial setup'", {
      cwd: dir,
      stdio: "pipe",
    });

    const mod = await import("./retroactive-harvester");
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Full Project",
      "full-project",
      "sk-fake-key"
    );

    // Should have gathered git log + handoff + CLAUDE.md + resolved debt = 4 artifacts
    expect(result.artifactsGathered).toBeGreaterThanOrEqual(4);
  });
});
