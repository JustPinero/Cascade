import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generatePrompt } from "./claude-dispatcher";
import fs from "fs/promises";
import path from "path";

const TEST_DIR = path.resolve(__dirname, "../.test-dispatcher");

describe("generatePrompt", () => {
  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    // Create a project with handoff and requests
    await fs.mkdir(path.join(TEST_DIR, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, ".claude", "handoff.md"),
      "# Handoff\nLast worked on auth module."
    );
    await fs.mkdir(path.join(TEST_DIR, "requests", "phase-2-features"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(TEST_DIR, "requests", "phase-2-features", "2.3-search.md"),
      "# Request 2.3\nBuild search feature."
    );
  });

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("generates continue prompt with handoff and request context", async () => {
    const prompt = await generatePrompt(TEST_DIR, "continue");
    expect(prompt).toContain("Read CLAUDE.md");
    expect(prompt).toContain("handoff");
    expect(prompt).toContain("action loop");
    expect(prompt).toContain("OVERSEER RULES");
  });

  it("generates audit prompt", async () => {
    const prompt = await generatePrompt(TEST_DIR, "audit");
    expect(prompt).toContain("audit suite");
    expect(prompt).toContain("OVERSEER RULES");
  });

  it("generates investigate prompt", async () => {
    const prompt = await generatePrompt(TEST_DIR, "investigate");
    expect(prompt).toContain("blockers");
    expect(prompt).toContain("debt.md");
  });

  it("uses custom prompt when mode is custom", async () => {
    const prompt = await generatePrompt(TEST_DIR, "custom", "Fix the login bug");
    expect(prompt).toContain("Fix the login bug");
    expect(prompt).toContain("OVERSEER RULES");
  });

  it("includes playbook rules in all prompts", async () => {
    const modes = ["continue", "audit", "investigate"] as const;
    for (const mode of modes) {
      const prompt = await generatePrompt(TEST_DIR, mode);
      expect(prompt).toContain("OVERSEER RULES");
    }
  });

  it("handles project with no handoff or requests gracefully", async () => {
    const emptyDir = path.join(TEST_DIR, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    const prompt = await generatePrompt(emptyDir, "continue");
    expect(prompt).toContain("Read CLAUDE.md");
    // Should not crash
  });
});
