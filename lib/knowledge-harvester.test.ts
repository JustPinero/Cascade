import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { harvestKnowledge } from "./knowledge-harvester";
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-harvest.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../.test-harvest");

let prisma: PrismaClient;

beforeAll(async () => {
  // Clean up
  try {
    const fss = await import("fs");
    fss.unlinkSync(TEST_DB_PATH);
  } catch {}
  await fs.rm(TEST_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  // Create test project directory with lessons
  const projDir = path.join(TEST_DIR, "test-project");
  await fs.mkdir(path.join(projDir, "audits"), { recursive: true });
  await fs.mkdir(path.join(projDir, ".claude"), { recursive: true });

  // File with [LESSON] tags
  await fs.writeFile(
    path.join(projDir, "audits", "debt.md"),
    `# Debt

## Open

[LESSON] Always use WAL mode: When using SQLite with Prisma, enable WAL mode for better concurrent read performance.

[LESSON] Validate inputs in API routes: Never trust client data. Always validate request bodies.

## Resolved
`
  );

  // Handoff file with a lesson
  await fs.writeFile(
    path.join(projDir, ".claude", "handoff.md"),
    `# Handoff

## Lessons
[LESSON] Use server components by default: Only add "use client" when hooks or event handlers are needed.
`
  );

  // Correction report
  await fs.writeFile(
    path.join(projDir, "audits", "correction-2026-01-15.md"),
    `# Correction Report

### Recommendations
- [FIX] Always check .git dir existence before running git commands to avoid parent repo inheritance
- [ADD] Add Suspense boundary for useSearchParams in static pages
- Too short
`
  );

  // Register the project in DB
  await prisma.project.create({
    data: {
      name: "Test Project",
      slug: "test-project",
      path: projDir,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    const fss = await import("fs");
    fss.unlinkSync(TEST_DB_PATH);
  } catch {}
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("harvestKnowledge", () => {
  it("extracts lessons from [LESSON] tags", async () => {
    const result = await harvestKnowledge(prisma);
    expect(result.newLessons).toBeGreaterThanOrEqual(3);
    expect(
      result.lessons.some((l) => l.title.includes("WAL mode"))
    ).toBe(true);
  });

  it("extracts lessons from correction reports", async () => {
    const lessons = await prisma.knowledgeLesson.findMany();
    const correctionLesson = lessons.find((l) =>
      l.title.includes(".git dir existence")
    );
    expect(correctionLesson).toBeDefined();
  });

  it("extracts lessons from handoff files", async () => {
    const lessons = await prisma.knowledgeLesson.findMany();
    const handoffLesson = lessons.find((l) =>
      l.title.includes("server components")
    );
    expect(handoffLesson).toBeDefined();
  });

  it("auto-categorizes lessons", async () => {
    const walLesson = await prisma.knowledgeLesson.findFirst({
      where: { title: { contains: "WAL mode" } },
    });
    expect(walLesson!.category).toBe("database");
  });

  it("assigns tags to lessons", async () => {
    const walLesson = await prisma.knowledgeLesson.findFirst({
      where: { title: { contains: "WAL mode" } },
    });
    const tags = JSON.parse(walLesson!.tags);
    expect(tags.length).toBeGreaterThan(0);
  });

  it("creates activity events for new lessons", async () => {
    const events = await prisma.activityEvent.findMany({
      where: { eventType: "lesson-harvested" },
    });
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("deduplicates on second run", async () => {
    const result = await harvestKnowledge(prisma);
    expect(result.newLessons).toBe(0);
    expect(result.duplicatesSkipped).toBeGreaterThan(0);
  });

  it("skips short correction items", async () => {
    const lessons = await prisma.knowledgeLesson.findMany();
    const shortLesson = lessons.find((l) => l.title === "Too short");
    expect(shortLesson).toBeUndefined();
  });

  it("handles project with no files gracefully", async () => {
    const emptyDir = path.join(TEST_DIR, "empty-project");
    await fs.mkdir(emptyDir, { recursive: true });

    await prisma.project.create({
      data: {
        name: "Empty Project",
        slug: "empty-project",
        path: emptyDir,
      },
    });

    const result = await harvestKnowledge(prisma);
    // Should not crash, just find no new lessons
    expect(result.scannedProjects).toBe(2);
  });
});
