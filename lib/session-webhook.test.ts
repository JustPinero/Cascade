import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { computeHealth } from "./health-engine";
import { toSlug } from "./scanner";

const TEST_DIR = path.resolve(__dirname, "../.test-webhook");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function createTestProject(
  name: string,
  opts: {
    git?: boolean;
    handoffContent?: string;
    debtItems?: string[];
  } = {}
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "audits"), { recursive: true });
  await fs.mkdir(path.join(dir, ".claude"), { recursive: true });

  // Write debt.md
  const debtItems = opts.debtItems || [];
  const debtContent = `# Debt\n\n## Open\n\n${debtItems.map((i) => `- ${i}`).join("\n")}\n\n## Resolved\n`;
  await fs.writeFile(path.join(dir, "audits", "debt.md"), debtContent);

  // Write handoff.md if content provided
  if (opts.handoffContent) {
    await fs.writeFile(
      path.join(dir, ".claude", "handoff.md"),
      opts.handoffContent
    );
  }

  // Initialize git
  if (opts.git) {
    execSync("git init && git add -A && git commit -m init", {
      cwd: dir,
      stdio: "pipe",
    });
  }

  return dir;
}

describe("toSlug", () => {
  it("converts project directory names to URL-safe slugs", () => {
    expect(toSlug("Alpha-App")).toBe("alpha-app");
    expect(toSlug("My Cool Project")).toBe("my-cool-project");
    expect(toSlug("CON-CORE")).toBe("con-core");
    expect(toSlug("site-unseen")).toBe("site-unseen");
  });

  it("strips leading/trailing hyphens", () => {
    expect(toSlug("-test-")).toBe("test");
  });

  it("collapses multiple non-alphanumeric characters", () => {
    expect(toSlug("foo---bar")).toBe("foo-bar");
    expect(toSlug("hello world!")).toBe("hello-world");
  });
});

describe("[NEEDS ATTENTION] detection", () => {
  it("detects [NEEDS ATTENTION] in handoff and sets health to blocked", async () => {
    const dir = await createTestProject("attention-needed", {
      git: true,
      handoffContent: `# Session Handoff
Date: 2026-04-03

## Status
Hit a CORS issue that I can't resolve.

[NEEDS ATTENTION] CORS headers not being set correctly in middleware. Tried adding headers to next.config.ts and middleware.ts but responses still missing Access-Control-Allow-Origin.
`,
    });

    const result = await computeHealth(dir);
    expect(result.health).toBe("blocked");
    expect(result.details.needsAttention).toBeDefined();
    expect(result.details.needsAttention).toContain("CORS");
  });

  it("does not trigger on clean handoff without [NEEDS ATTENTION]", async () => {
    const dir = await createTestProject("clean-handoff", {
      git: true,
      handoffContent: `# Session Handoff
Date: 2026-04-03

## Status
All tests passing. Completed request 2.3.
`,
    });

    const result = await computeHealth(dir);
    expect(result.health).toBe("healthy");
    expect(result.details.needsAttention).toBeUndefined();
  });

  it("handles missing handoff.md gracefully", async () => {
    const dir = await createTestProject("no-handoff", { git: true });
    const result = await computeHealth(dir);
    // Should not crash, should not be blocked from missing file
    expect(result.health).not.toBe("blocked");
  });
});
