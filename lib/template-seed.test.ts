import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-seed.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Phase 30 — the `templates/` directory is gitignored (each user
// populates it themselves) and may not exist on a fresh checkout.
// Skip the whole file when the default template is missing instead of
// failing the suite with an ENOENT from the seed subprocess.
const DEFAULT_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../templates/web-app-v3.3.md"
);
const templatesAvailable = fs.existsSync(DEFAULT_TEMPLATE_PATH);
const describeIfTemplates = templatesAvailable ? describe : describe.skip;

let prisma: PrismaClient;

beforeAll(() => {
  if (!templatesAvailable) return;
  // Clean up any existing test database
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  // Push schema
  pushTestSchema(TEST_DB_URL);

  // Run seed
  execSync("npx tsx prisma/seed.ts", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
});

afterAll(async () => {
  if (!templatesAvailable) return;
  await prisma.$disconnect();
  try {
    fs.rmSync(TEST_DB_PATH, { force: true, maxRetries: 10, retryDelay: 100 });
  } catch {}
});

describeIfTemplates("template seeding", () => {
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
