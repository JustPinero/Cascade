import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getAdvisoryStatuses, getConsumptionRate } from "./advisory-tracker";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-tracker.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../.test-tracker");

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."), stdio: "pipe",
  });

  // Project with unread advisory
  const unreadDir = path.join(TEST_DIR, "unread-project");
  fs.mkdirSync(path.join(unreadDir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(unreadDir, ".claude", "nerve-center-advisory.md"), "# Advisory");
  await prisma.project.create({
    data: { name: "Unread", slug: "unread", path: unreadDir },
  });

  // Project with read advisory
  const readDir = path.join(TEST_DIR, "read-project");
  fs.mkdirSync(path.join(readDir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(readDir, ".claude", "nerve-center-advisory-read.md"), "# Read");
  await prisma.project.create({
    data: { name: "Read", slug: "read", path: readDir },
  });

  // Project with no advisory
  const cleanDir = path.join(TEST_DIR, "clean-project");
  fs.mkdirSync(cleanDir, { recursive: true });
  await prisma.project.create({
    data: { name: "Clean", slug: "clean", path: cleanDir },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getAdvisoryStatuses", () => {
  it("detects unread advisory", async () => {
    const statuses = await getAdvisoryStatuses(prisma);
    const unread = statuses.find((s) => s.projectSlug === "unread");
    expect(unread!.hasAdvisory).toBe(true);
    expect(unread!.isRead).toBe(false);
  });

  it("detects read advisory", async () => {
    const statuses = await getAdvisoryStatuses(prisma);
    const read = statuses.find((s) => s.projectSlug === "read");
    expect(read!.hasAdvisory).toBe(true);
    expect(read!.isRead).toBe(true);
  });

  it("detects no advisory", async () => {
    const statuses = await getAdvisoryStatuses(prisma);
    const clean = statuses.find((s) => s.projectSlug === "clean");
    expect(clean!.hasAdvisory).toBe(false);
  });
});

describe("getConsumptionRate", () => {
  it("calculates correct consumption rate", async () => {
    const statuses = await getAdvisoryStatuses(prisma);
    const rate = getConsumptionRate(statuses);
    expect(rate.total).toBe(2); // unread + read
    expect(rate.read).toBe(1);  // only read
    expect(rate.rate).toBe(0.5); // 1/2
  });

  it("returns 0 rate when no advisories", () => {
    const rate = getConsumptionRate([
      { projectName: "A", projectSlug: "a", hasAdvisory: false, isRead: false },
    ]);
    expect(rate.total).toBe(0);
    expect(rate.rate).toBe(0);
  });
});
