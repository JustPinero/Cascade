import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeHealth } from "./health-engine";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

const TEST_DIR = path.resolve(__dirname, "../.test-health");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function createProject(
  name: string,
  opts: {
    git?: boolean;
    dirty?: boolean;
    debtItems?: string[];
    auditGrade?: string;
    auditFindings?: number;
  } = {}
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "audits"), { recursive: true });

  // Write debt.md
  const debtItems = opts.debtItems || [];
  const debtContent = `# Debt\n\n## Open\n\n${debtItems.map((i) => `- ${i}`).join("\n")}\n\n## Resolved\n`;
  await fs.writeFile(path.join(dir, "audits", "debt.md"), debtContent);

  // Write audit file if needed
  if (opts.auditGrade || opts.auditFindings) {
    const findings = Array.from(
      { length: opts.auditFindings || 0 },
      (_, i) => `- [BUG-${i + 1}] Finding ${i + 1}`
    ).join("\n");
    const auditContent = `# Audit\n\nGrade: ${opts.auditGrade || "A"}\n\n${findings}\n`;
    await fs.writeFile(
      path.join(dir, "audits", "audit-2026-01-01.md"),
      auditContent
    );
  }

  // Initialize git
  if (opts.git) {
    execSync("git init && git add -A && git commit -m init", {
      cwd: dir,
      stdio: "pipe",
    });

    if (opts.dirty) {
      await fs.writeFile(path.join(dir, "dirty.txt"), "uncommitted");
    }
  }

  return dir;
}

describe("computeHealth", () => {
  it("returns healthy for clean project with git", async () => {
    const dir = await createProject("healthy-project", { git: true });
    const result = await computeHealth(dir);

    expect(result.health).toBe("healthy");
    expect(result.openDebtCount).toBe(0);
    expect(result.gitDirty).toBe(false);
  });

  it("returns idle for project without git", async () => {
    const dir = await createProject("no-git-project");
    const result = await computeHealth(dir);

    expect(result.health).toBe("idle");
  });

  it("returns warning for project with uncommitted changes", async () => {
    const dir = await createProject("dirty-project", {
      git: true,
      dirty: true,
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("warning");
    expect(result.gitDirty).toBe(true);
  });

  it("returns warning for project with open debt", async () => {
    const dir = await createProject("debt-project", {
      git: true,
      debtItems: ["Fix login bug", "Refactor auth module"],
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("warning");
    expect(result.openDebtCount).toBe(2);
    expect(result.details.debtItems).toContain("Fix login bug");
  });

  it("returns blocked for project with 5+ debt items", async () => {
    const dir = await createProject("blocked-debt", {
      git: true,
      debtItems: ["A", "B", "C", "D", "E"],
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("blocked");
    expect(result.openDebtCount).toBe(5);
  });

  it("returns blocked for Critical audit grade", async () => {
    const dir = await createProject("critical-project", {
      git: true,
      auditGrade: "Critical",
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("blocked");
    expect(result.lastAuditGrade).toBe("Critical");
  });

  it("returns warning for C/D/F audit grades", async () => {
    const dir = await createProject("c-grade", {
      git: true,
      auditGrade: "C",
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("warning");
    expect(result.lastAuditGrade).toBe("C");
  });

  it("returns blocked for 10+ audit findings", async () => {
    const dir = await createProject("many-findings", {
      git: true,
      auditGrade: "B",
      auditFindings: 12,
    });
    const result = await computeHealth(dir);

    expect(result.health).toBe("blocked");
    expect(result.details.auditFindings).toBe(12);
  });

  it("handles missing audits directory gracefully", async () => {
    const dir = path.join(TEST_DIR, "no-audits");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const result = await computeHealth(dir);
    expect(result.openDebtCount).toBe(0);
    expect(result.lastAuditGrade).toBeNull();
  });

  it("handles nonexistent project path", async () => {
    const result = await computeHealth("/nonexistent/project");
    expect(result.health).toBe("idle");
    expect(result.openDebtCount).toBe(0);
  });

  it("returns git branch info in details", async () => {
    const dir = await createProject("branch-project", { git: true });
    const result = await computeHealth(dir);

    expect(result.details.gitBranch).toBeTruthy();
  });
});
