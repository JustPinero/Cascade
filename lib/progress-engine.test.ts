import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { computeProgress } from "./progress-engine";

const TEST_DIR = path.resolve(__dirname, "../.test-progress");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

/**
 * Helper: create a project with phase-based request folders.
 */
async function createPhasedProject(
  name: string,
  phases: Record<string, string[]>,
  opts: {
    currentPhase?: string;
    currentRequest?: string | null;
    testFiles?: string[];
    packageScripts?: Record<string, string>;
  } = {}
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  // Create requests/ with phase folders
  const requestsDir = path.join(dir, "requests");
  await fs.mkdir(requestsDir, { recursive: true });
  for (const [phase, requests] of Object.entries(phases)) {
    const phaseDir = path.join(requestsDir, phase);
    await fs.mkdir(phaseDir, { recursive: true });
    for (const req of requests) {
      await fs.writeFile(path.join(phaseDir, req), `# ${req}\n`);
    }
  }

  // Create test files if specified
  if (opts.testFiles) {
    for (const tf of opts.testFiles) {
      const tfPath = path.join(dir, tf);
      await fs.mkdir(path.dirname(tfPath), { recursive: true });
      await fs.writeFile(tfPath, `// test file\n`);
    }
  }

  // Create package.json if scripts specified
  if (opts.packageScripts) {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: opts.packageScripts }, null, 2)
    );
  }

  return dir;
}

/**
 * Helper: create a project with flat sequential requests (medipal-style).
 */
async function createFlatProject(
  name: string,
  requests: string[],
  opts: {
    currentRequest?: string | null;
    testFiles?: string[];
  } = {}
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const requestsDir = path.join(dir, "requests");
  await fs.mkdir(requestsDir, { recursive: true });
  for (const req of requests) {
    await fs.writeFile(path.join(requestsDir, req), `# ${req}\n`);
  }

  if (opts.testFiles) {
    for (const tf of opts.testFiles) {
      const tfPath = path.join(dir, tf);
      await fs.mkdir(path.dirname(tfPath), { recursive: true });
      await fs.writeFile(tfPath, `// test file\n`);
    }
  }

  return dir;
}

describe("computeProgress", () => {
  describe("phase completion scoring (50 pts)", () => {
    it("scores 0 for project at phase 1 with no completed requests", async () => {
      const dir = await createPhasedProject("phase-start", {
        "phase-1-foundation": ["1.1-scaffold.md", "1.2-schema.md"],
        "phase-2-dashboard": ["2.1-tiles.md", "2.2-health.md"],
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.phases.score).toBe(0);
      expect(result.phases.completed).toBe(0);
      expect(result.phases.total).toBe(4);
    });

    it("scores full 50 for project past final phase", async () => {
      const dir = await createPhasedProject("phase-done", {
        "phase-1-foundation": ["1.1-scaffold.md", "1.2-schema.md"],
        "phase-2-dashboard": ["2.1-tiles.md"],
      });

      // currentPhase beyond all phases means everything is done
      const result = await computeProgress(dir, "phase-3-future", null);
      expect(result.phases.score).toBe(50);
      expect(result.phases.completed).toBe(3);
      expect(result.phases.total).toBe(3);
    });

    it("scores proportionally for mid-project progress", async () => {
      const dir = await createPhasedProject("phase-mid", {
        "phase-1-foundation": [
          "1.1-scaffold.md",
          "1.2-schema.md",
          "1.3-scanner.md",
        ],
        "phase-2-dashboard": ["2.1-tiles.md", "2.2-health.md", "2.3-grid.md"],
        "phase-3-knowledge": ["3.1-harvester.md", "3.2-search.md"],
      });

      // In phase 2, on request 2.2 — phase 1 done (3), 2.1 done (1) = 4 of 8
      const result = await computeProgress(dir, "phase-2-dashboard", "2.2");
      expect(result.phases.completed).toBe(4); // 3 from phase 1 + 1 from phase 2
      expect(result.phases.total).toBe(8);
      expect(result.phases.score).toBe(25); // 4/8 * 50
    });

    it("handles flat sequential requests (medipal-style)", async () => {
      const dir = await createFlatProject("flat-project", [
        "001-setup.md",
        "002-schema.md",
        "003-api.md",
        "004-auth.md",
        "005-websocket.md",
      ]);

      // On request 003 means 001 and 002 are done = 2 of 5
      const result = await computeProgress(dir, "phase-1-foundation", "003");
      expect(result.phases.completed).toBe(2);
      expect(result.phases.total).toBe(5);
      expect(result.phases.score).toBe(20); // 2/5 * 50
    });

    it("handles flat requests with current request matching filename prefix", async () => {
      const dir = await createFlatProject("flat-mid", [
        "001-setup.md",
        "002-schema.md",
        "003-api.md",
        "004-auth.md",
      ]);

      // All done
      const result = await computeProgress(dir, "phase-1-foundation", "005");
      expect(result.phases.completed).toBe(4);
      expect(result.phases.total).toBe(4);
      expect(result.phases.score).toBe(50);
    });
  });

  describe("test health scoring (25 pts)", () => {
    it("scores 0 when no test files exist", async () => {
      const dir = await createPhasedProject("no-tests", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.tests.score).toBe(0);
      expect(result.tests.fileCount).toBe(0);
    });

    it("scores based on test file count as proxy", async () => {
      const dir = await createPhasedProject("with-tests", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      }, {
        testFiles: [
          "lib/auth.test.ts",
          "lib/db.test.ts",
          "app/components/tile.test.tsx",
        ],
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.tests.fileCount).toBe(3);
      expect(result.tests.score).toBeGreaterThan(0);
      expect(result.tests.score).toBeLessThanOrEqual(25);
    });

    it("caps test score at 25", async () => {
      const testFiles = Array.from({ length: 30 }, (_, i) => `lib/test-${i}.test.ts`);
      const dir = await createPhasedProject("many-tests", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      }, { testFiles });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.tests.score).toBeLessThanOrEqual(25);
    });
  });

  describe("build readiness scoring (25 pts)", () => {
    it("scores 0 when no package.json exists", async () => {
      const dir = await createPhasedProject("no-pkg", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.readiness.score).toBe(0);
      expect(result.readiness.hasTypeCheck).toBe(false);
      expect(result.readiness.hasLint).toBe(false);
      expect(result.readiness.hasBuild).toBe(false);
    });

    it("detects available build scripts from package.json", async () => {
      const dir = await createPhasedProject("has-scripts", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      }, {
        packageScripts: {
          build: "next build",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
        },
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.readiness.hasTypeCheck).toBe(true);
      expect(result.readiness.hasLint).toBe(true);
      expect(result.readiness.hasBuild).toBe(true);
      // Score is based on script existence (not execution) during light scan
      expect(result.readiness.score).toBeGreaterThan(0);
    });

    it("detects tsc in various script formats", async () => {
      const dir = await createPhasedProject("tsc-variants", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      }, {
        packageScripts: {
          "check-types": "pnpm exec tsc --noEmit",
        },
      });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.readiness.hasTypeCheck).toBe(true);
    });
  });

  describe("total score", () => {
    it("sums all three pillars correctly", async () => {
      const dir = await createPhasedProject("full-project", {
        "phase-1-foundation": ["1.1-scaffold.md", "1.2-schema.md"],
        "phase-2-dashboard": ["2.1-tiles.md", "2.2-health.md"],
      }, {
        testFiles: ["lib/a.test.ts", "lib/b.test.ts"],
        packageScripts: { build: "next build", lint: "eslint .", typecheck: "tsc --noEmit" },
      });

      const result = await computeProgress(dir, "phase-2-dashboard", "2.2");
      expect(result.total).toBe(
        result.phases.score + result.tests.score + result.readiness.score
      );
      expect(result.total).toBeGreaterThan(0);
      expect(result.total).toBeLessThanOrEqual(100);
    });

    it("includes scannedAt timestamp", async () => {
      const dir = await createPhasedProject("timestamp-check", {
        "phase-1-foundation": ["1.1-scaffold.md"],
      });

      const before = new Date().toISOString();
      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.scannedAt).toBeDefined();
      expect(result.scannedAt >= before).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles missing requests directory", async () => {
      const dir = path.join(TEST_DIR, "no-requests");
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });

      const result = await computeProgress(dir, "phase-1-foundation", null);
      expect(result.phases.score).toBe(0);
      expect(result.phases.total).toBe(0);
      expect(result.phases.completed).toBe(0);
    });

    it("handles nonexistent project path", async () => {
      const result = await computeProgress(
        "/nonexistent/path",
        "phase-1-foundation",
        null
      );
      expect(result.total).toBe(0);
      expect(result.phases.score).toBe(0);
      expect(result.tests.score).toBe(0);
      expect(result.readiness.score).toBe(0);
    });

    it("handles empty phase folders", async () => {
      const dir = await createPhasedProject("empty-phases", {
        "phase-1-foundation": [],
        "phase-2-dashboard": ["2.1-tiles.md"],
      });

      const result = await computeProgress(dir, "phase-2-dashboard", "2.1");
      expect(result.phases.total).toBe(1);
      expect(result.phases.completed).toBe(0);
    });
  });
});
