import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { importSingleProject } from "@/lib/project-import";
import { toSlug } from "@/lib/scanner";

const TEST_DB_PATH = path.resolve(
  __dirname,
  "../../../prisma/test-api-webhook.db"
);
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../../../.test-webhook-api");

let prisma: PrismaClient;

beforeAll(async () => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "pipe",
  });

  // Create a test project directory with git
  const projDir = path.join(TEST_DIR, "Test-Project");
  fs.mkdirSync(path.join(projDir, "audits"), { recursive: true });
  fs.mkdirSync(path.join(projDir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# Test");
  fs.writeFileSync(
    path.join(projDir, "audits", "debt.md"),
    "# Debt\n\n## Open\n\n## Resolved\n"
  );
  execSync("git init && git add -A && git commit -m init", {
    cwd: projDir,
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("session-complete webhook logic", () => {
  it("resolves project slug from path using toSlug", () => {
    expect(toSlug(path.basename("/Users/dev/projects/My-Cool-App"))).toBe(
      "my-cool-app"
    );
    expect(toSlug(path.basename("/Users/dev/projects/ratracer"))).toBe(
      "ratracer"
    );
  });

  it("importSingleProject creates a new project record", async () => {
    const projDir = path.join(TEST_DIR, "Test-Project");
    const result = await importSingleProject(prisma, projDir);

    expect(result.slug).toBe("test-project");
    expect(result.name).toBe("Test-Project");
    expect(result.action).toBe("created");

    const project = await prisma.project.findUnique({
      where: { slug: "test-project" },
    });
    expect(project).not.toBeNull();
    expect(project!.health).toBe("healthy");
    expect(project!.lastSessionEndedAt).not.toBeNull();
  });

  it("importSingleProject updates existing project on re-scan", async () => {
    const projDir = path.join(TEST_DIR, "Test-Project");
    const result = await importSingleProject(prisma, projDir);

    expect(result.action).toBe("updated");
  });

  it("importSingleProject detects [NEEDS ATTENTION] and sets blocked", async () => {
    const projDir = path.join(TEST_DIR, "Test-Project");

    // Write a handoff with [NEEDS ATTENTION]
    await fsp.writeFile(
      path.join(projDir, ".claude", "handoff.md"),
      "# Handoff\n\n[NEEDS ATTENTION] Auth middleware is broken, tests failing.\n"
    );

    const result = await importSingleProject(prisma, projDir);
    expect(result.action).toBe("updated");

    const project = await prisma.project.findUnique({
      where: { slug: "test-project" },
    });
    expect(project!.health).toBe("blocked");

    const details = JSON.parse(project!.healthDetails);
    expect(details.needsAttention).toContain("Auth middleware");
  });

  it("importSingleProject clears [NEEDS ATTENTION] when tag is removed", async () => {
    const projDir = path.join(TEST_DIR, "Test-Project");

    // Write a clean handoff and commit so git is clean
    await fsp.writeFile(
      path.join(projDir, ".claude", "handoff.md"),
      "# Handoff\n\nAll good. Tests passing.\n"
    );
    execSync("git add -A && git commit -m 'clean handoff'", {
      cwd: projDir,
      stdio: "pipe",
    });

    await importSingleProject(prisma, projDir);

    const project = await prisma.project.findUnique({
      where: { slug: "test-project" },
    });
    expect(project!.health).toBe("healthy");

    const details = JSON.parse(project!.healthDetails);
    expect(details.needsAttention).toBeUndefined();
  });
});
