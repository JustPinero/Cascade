import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scanProjects } from "./scanner";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const TEST_DIR = path.resolve(__dirname, "../.test-projects");

beforeAll(async () => {
  // Create test project directories
  await fs.mkdir(TEST_DIR, { recursive: true });

  // Project A: full structure with git
  const projA = path.join(TEST_DIR, "Project-Alpha");
  await fs.mkdir(projA, { recursive: true });
  await fs.mkdir(path.join(projA, "audits"), { recursive: true });
  await fs.mkdir(path.join(projA, "requests"), { recursive: true });
  await fs.writeFile(path.join(projA, "CLAUDE.md"), "# Project Alpha");
  execSync("git init", { cwd: projA, stdio: "pipe" });
  execSync("git add -A && git commit --allow-empty -m 'init'", {
    cwd: projA,
    stdio: "pipe",
  });

  // Project B: minimal (no CLAUDE.md, no audits, no git)
  const projB = path.join(TEST_DIR, "project-beta");
  await fs.mkdir(projB, { recursive: true });
  await fs.writeFile(path.join(projB, "README.md"), "# Beta");

  // Hidden directory (should be skipped)
  await fs.mkdir(path.join(TEST_DIR, ".hidden-project"), { recursive: true });

  // Regular file (should be skipped)
  await fs.writeFile(path.join(TEST_DIR, "not-a-project.txt"), "skip me");
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("scanProjects", () => {
  it("finds all project directories", async () => {
    const results = await scanProjects(TEST_DIR);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name);
    expect(names).toContain("Project-Alpha");
    expect(names).toContain("project-beta");
  });

  it("generates correct slugs", async () => {
    const results = await scanProjects(TEST_DIR);
    const alpha = results.find((r) => r.name === "Project-Alpha");
    expect(alpha!.slug).toBe("project-alpha");
  });

  it("detects CLAUDE.md presence", async () => {
    const results = await scanProjects(TEST_DIR);
    const alpha = results.find((r) => r.name === "Project-Alpha");
    const beta = results.find((r) => r.name === "project-beta");
    expect(alpha!.hasClaude).toBe(true);
    expect(beta!.hasClaude).toBe(false);
  });

  it("detects git status", async () => {
    const results = await scanProjects(TEST_DIR);
    const alpha = results.find((r) => r.name === "Project-Alpha");
    const beta = results.find((r) => r.name === "project-beta");
    expect(alpha!.hasGit).toBe(true);
    expect(alpha!.gitBranch).toBeTruthy();
    expect(beta!.hasGit).toBe(false);
    expect(beta!.gitBranch).toBeNull();
  });

  it("detects audit and request directories", async () => {
    const results = await scanProjects(TEST_DIR);
    const alpha = results.find((r) => r.name === "Project-Alpha");
    const beta = results.find((r) => r.name === "project-beta");
    expect(alpha!.hasAudits).toBe(true);
    expect(alpha!.hasRequests).toBe(true);
    expect(beta!.hasAudits).toBe(false);
    expect(beta!.hasRequests).toBe(false);
  });

  it("detects git dirty status", async () => {
    // Add an untracked file to make alpha dirty
    const projA = path.join(TEST_DIR, "Project-Alpha");
    await fs.writeFile(path.join(projA, "new-file.txt"), "dirty");

    const results = await scanProjects(TEST_DIR);
    const alpha = results.find((r) => r.name === "Project-Alpha");
    expect(alpha!.gitDirty).toBe(true);

    const beta = results.find((r) => r.name === "project-beta");
    expect(beta!.gitDirty).toBe(false);
  });

  it("skips hidden directories", async () => {
    const results = await scanProjects(TEST_DIR);
    const names = results.map((r) => r.name);
    expect(names).not.toContain(".hidden-project");
  });

  it("skips regular files", async () => {
    const results = await scanProjects(TEST_DIR);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("not-a-project.txt");
  });

  it("returns lastModified as Date", async () => {
    const results = await scanProjects(TEST_DIR);
    for (const r of results) {
      expect(r.lastModified).toBeInstanceOf(Date);
    }
  });

  it("returns empty array for missing directory", async () => {
    const results = await scanProjects("/nonexistent/path/that/does/not/exist");
    expect(results).toEqual([]);
  });

  it("supports incremental scanning with since option", async () => {
    // First scan: get all projects
    const allResults = await scanProjects(TEST_DIR);
    expect(allResults.length).toBeGreaterThan(0);

    // Use a future date — nothing should be returned
    const futureDate = new Date(Date.now() + 60_000);
    const noResults = await scanProjects(TEST_DIR, { since: futureDate });
    expect(noResults).toHaveLength(0);

    // Use a past date — everything should be returned
    const pastDate = new Date(Date.now() - 60_000);
    const allAgain = await scanProjects(TEST_DIR, { since: pastDate });
    expect(allAgain.length).toBe(allResults.length);
  });
});
