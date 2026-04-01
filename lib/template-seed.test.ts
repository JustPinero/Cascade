import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-seed.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(() => {
  // Clean up any existing test database
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  // Push schema
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  // Run seed
  execSync("npx tsx prisma/seed.ts", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
});

describe("template seeding", () => {
  it("creates a template record in the database", async () => {
    const templates = await prisma.kickoffTemplate.findMany();
    expect(templates.length).toBeGreaterThanOrEqual(1);
  });

  it("marks the default template", async () => {
    const defaultTemplate = await prisma.kickoffTemplate.findFirst({
      where: { isDefault: true },
    });
    expect(defaultTemplate).not.toBeNull();
    expect(defaultTemplate!.name).toBe("Web App v3.3");
    expect(defaultTemplate!.projectType).toBe("web-app");
  });

  it("template content matches the file on disk", async () => {
    const templatePath = path.resolve(__dirname, "../templates/web-app-v3.3.md");
    const fileContent = fs.readFileSync(templatePath, "utf-8");

    const dbTemplate = await prisma.kickoffTemplate.findFirst({
      where: { name: "Web App v3.3" },
    });

    expect(dbTemplate!.content).toBe(fileContent);
  });

  it("template file exists in templates/", () => {
    const templatePath = path.resolve(__dirname, "../templates/web-app-v3.3.md");
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it("seed is idempotent — running twice doesn't create duplicates", () => {
    // Run seed again
    execSync("npx tsx prisma/seed.ts", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    });

    // Same count after re-seed (upsert, not duplicate)
    return prisma.kickoffTemplate.findMany().then((templates) => {
      expect(templates).toHaveLength(6);
    });
  });
});
