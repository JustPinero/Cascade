import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-seed.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

function runSeed() {
  execSync("npx tsx prisma/seed.ts", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
}

beforeAll(() => {
  // Clean up any existing test database
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  // Push schema
  pushTestSchema(TEST_DB_URL);

  // Run seed
  runSeed();
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
});

// The six canonical v4.0 kickoff templates and their expected
// projectType mapping (KickoffTemplate.projectType enum-by-convention:
// web-app | game | api | mobile | other).
const V4_TEMPLATES: {
  filename: string;
  projectType: string;
  isDefault: boolean;
}[] = [
  { filename: "universal-v4_0.md", projectType: "other", isDefault: true },
  { filename: "web-app-v4_0.md", projectType: "web-app", isDefault: false },
  { filename: "api-service-v4_0.md", projectType: "api", isDefault: false },
  { filename: "mobile-app-v4_0.md", projectType: "mobile", isDefault: false },
  { filename: "site-rebuild-v4_0.md", projectType: "web-app", isDefault: false },
  { filename: "game-dev-v4_0.md", projectType: "game", isDefault: false },
];

describe("template seeding (v4.0)", () => {
  it("seeds exactly the six v4.0 templates", async () => {
    const templates = await prisma.kickoffTemplate.findMany();
    expect(templates).toHaveLength(6);
  });

  it("all six v4.0 template files exist in templates/", () => {
    for (const tmpl of V4_TEMPLATES) {
      const templatePath = path.resolve(
        __dirname,
        "../templates",
        tmpl.filename
      );
      expect(fs.existsSync(templatePath), tmpl.filename).toBe(true);
    }
  });

  it("each row's content matches its v4.0 file on disk", async () => {
    for (const tmpl of V4_TEMPLATES) {
      const templatePath = path.resolve(
        __dirname,
        "../templates",
        tmpl.filename
      );
      const fileContent = fs.readFileSync(templatePath, "utf-8");

      const row = await prisma.kickoffTemplate.findFirst({
        where: { content: fileContent },
      });
      expect(row, `no row seeded from ${tmpl.filename}`).not.toBeNull();
    }
  });

  it("maps each template to the correct projectType", async () => {
    for (const tmpl of V4_TEMPLATES) {
      const templatePath = path.resolve(
        __dirname,
        "../templates",
        tmpl.filename
      );
      const fileContent = fs.readFileSync(templatePath, "utf-8");

      const row = await prisma.kickoffTemplate.findFirst({
        where: { content: fileContent },
      });
      expect(row, `no row seeded from ${tmpl.filename}`).not.toBeNull();
      expect(row!.projectType, tmpl.filename).toBe(tmpl.projectType);
    }
  });

  it("the universal template is the sole default", async () => {
    const defaults = await prisma.kickoffTemplate.findMany({
      where: { isDefault: true },
    });
    expect(defaults).toHaveLength(1);

    const universalContent = fs.readFileSync(
      path.resolve(__dirname, "../templates/universal-v4_0.md"),
      "utf-8"
    );
    expect(defaults[0].content).toBe(universalContent);
    expect(defaults[0].projectType).toBe("other");
  });

  it("every seeded template has non-empty content containing VERSION: 4.0", async () => {
    const templates = await prisma.kickoffTemplate.findMany();
    expect(templates).toHaveLength(6);
    for (const row of templates) {
      expect(row.content.length, row.name).toBeGreaterThan(0);
      expect(row.content, row.name).toContain("VERSION: 4.0");
    }
  });

  it("seed is idempotent — running twice keeps exactly 6 rows", async () => {
    runSeed();

    const templates = await prisma.kickoffTemplate.findMany();
    expect(templates).toHaveLength(6);
  });
});
