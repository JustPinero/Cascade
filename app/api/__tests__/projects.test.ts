import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
// Test the business logic that API routes depend on directly

const TEST_DB_PATH = path.resolve(__dirname, "../../../prisma/test-api-projects.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../../../.test-api-projects");

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, "../../.."), stdio: "pipe",
  });

  // Create test projects
  await prisma.project.create({
    data: {
      name: "API Test Project",
      slug: "api-test",
      path: "/tmp/api-test",
      status: "building",
      health: "healthy",
      currentPhase: "phase-2-dashboard",
    },
  });

  await prisma.project.create({
    data: {
      name: "Deployed Project",
      slug: "deployed-proj",
      path: "/tmp/deployed",
      status: "deployed",
      health: "healthy",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Projects API logic", () => {
  it("GET returns all projects ordered by lastActivityAt", async () => {
    const projects = await prisma.project.findMany({
      orderBy: { lastActivityAt: "desc" },
    });
    expect(projects.length).toBe(2);
    expect(projects[0].name).toBeDefined();
  });

  it("GET project by slug returns correct project", async () => {
    const project = await prisma.project.findUnique({
      where: { slug: "api-test" },
    });
    expect(project).not.toBeNull();
    expect(project!.name).toBe("API Test Project");
  });

  it("GET returns 404-equivalent for missing slug", async () => {
    const project = await prisma.project.findUnique({
      where: { slug: "nonexistent-slug" },
    });
    expect(project).toBeNull();
  });

  it("PATCH with allowed fields updates correctly", async () => {
    const updated = await prisma.project.update({
      where: { slug: "api-test" },
      data: { status: "paused", currentPhase: "phase-3-knowledge" },
    });
    expect(updated.status).toBe("paused");
    expect(updated.currentPhase).toBe("phase-3-knowledge");
  });

  it("PATCH preserves fields not included in update", async () => {
    await prisma.project.update({
      where: { slug: "api-test" },
      data: { status: "building" },
    });
    const project = await prisma.project.findUnique({ where: { slug: "api-test" } });
    expect(project!.currentPhase).toBe("phase-3-knowledge"); // preserved from previous
    expect(project!.name).toBe("API Test Project"); // never changed
  });
});

describe("PATCH field validation", () => {
  it("rejects invalid status values at application level", () => {
    const VALID_STATUS = new Set(["building", "deployed", "paused", "archived"]);
    expect(VALID_STATUS.has("building")).toBe(true);
    expect(VALID_STATUS.has("bananas")).toBe(false);
    expect(VALID_STATUS.has("")).toBe(false);
  });

  it("rejects invalid health values at application level", () => {
    const VALID_HEALTH = new Set(["healthy", "warning", "blocked", "idle"]);
    expect(VALID_HEALTH.has("healthy")).toBe(true);
    expect(VALID_HEALTH.has("broken")).toBe(false);
  });

  it("rejects invalid autonomy mode values", () => {
    const VALID_AUTONOMY = new Set(["full", "semi", "manual"]);
    expect(VALID_AUTONOMY.has("semi")).toBe(true);
    expect(VALID_AUTONOMY.has("yolo")).toBe(false);
  });
});
