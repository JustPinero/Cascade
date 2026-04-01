import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { generateAdvisories } from "./advisory-engine";
import { execSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-advisory.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../.test-advisory");

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  // Create project with issues
  const projPath = path.join(TEST_DIR, "issue-project");
  fs.mkdirSync(projPath, { recursive: true });

  await prisma.project.create({
    data: {
      name: "Issue Project",
      slug: "issue-project",
      path: projPath,
      health: "warning",
      healthDetails: JSON.stringify({
        debtItems: ["SQLite database connection pool timeout", "Prisma query slow"],
      }),
    },
  });

  // Create matching knowledge lesson
  await prisma.knowledgeLesson.create({
    data: {
      title: "Use WAL mode for SQLite",
      content: "Enable WAL journal mode for concurrent database reads with Prisma. Fixes connection pool issues.",
      category: "database",
      severity: "critical",
      tags: JSON.stringify(["sqlite", "prisma", "database"]),
    },
  });

  // Create project with no issues
  const cleanPath = path.join(TEST_DIR, "clean-project");
  fs.mkdirSync(cleanPath, { recursive: true });

  await prisma.project.create({
    data: {
      name: "Clean Project",
      slug: "clean-project",
      path: cleanPath,
      health: "healthy",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("advisory-engine", () => {
  it("generates advisory for project with matching issues", async () => {
    const result = await generateAdvisories(prisma);
    expect(result.advisoriesWritten).toBeGreaterThanOrEqual(1);
    expect(result.advisories.some((a) => a.project === "Issue Project")).toBe(true);
  });

  it("writes advisory file to project directory", async () => {
    const advisoryPath = path.join(
      TEST_DIR,
      "issue-project",
      ".claude",
      "nerve-center-advisory.md"
    );
    const exists = fs.existsSync(advisoryPath);
    expect(exists).toBe(true);

    const content = await fsp.readFile(advisoryPath, "utf-8");
    expect(content).toContain("Nerve Center Advisory");
    expect(content).toContain("WAL mode");
  });

  it("does not write advisory for clean project", () => {
    const advisoryPath = path.join(
      TEST_DIR,
      "clean-project",
      ".claude",
      "nerve-center-advisory.md"
    );
    expect(fs.existsSync(advisoryPath)).toBe(false);
  });

  it("logs activity event for advisory", async () => {
    const events = await prisma.activityEvent.findMany({
      where: { eventType: "advisory-sent" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
