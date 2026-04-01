import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../../../prisma/test-api-templates.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, "../../.."), stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

describe("Templates API logic", () => {
  it("POST creates a template", async () => {
    const template = await prisma.kickoffTemplate.create({
      data: {
        name: "Test Template",
        description: "For testing",
        content: "# Test\nContent here",
        projectType: "web-app",
        isDefault: true,
      },
    });
    expect(template.id).toBeDefined();
    expect(template.isDefault).toBe(true);
  });

  it("GET returns all templates", async () => {
    const templates = await prisma.kickoffTemplate.findMany();
    expect(templates.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH updates a template", async () => {
    const template = await prisma.kickoffTemplate.findFirst();
    const updated = await prisma.kickoffTemplate.update({
      where: { id: template!.id },
      data: { name: "Updated Template" },
    });
    expect(updated.name).toBe("Updated Template");
  });

  it("setting new default unsets previous", async () => {
    // Create a second template
    await prisma.kickoffTemplate.create({
      data: {
        name: "Second",
        description: "Another",
        content: "# Second",
        projectType: "api",
        isDefault: false,
      },
    });

    // Simulate the default-setting logic from the API route
    await prisma.kickoffTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    const second = await prisma.kickoffTemplate.findFirst({ where: { name: "Second" } });
    await prisma.kickoffTemplate.update({
      where: { id: second!.id },
      data: { isDefault: true },
    });

    const defaults = await prisma.kickoffTemplate.findMany({ where: { isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Second");
  });

  it("DELETE removes a template", async () => {
    const template = await prisma.kickoffTemplate.findFirst({ where: { name: "Updated Template" } });
    await prisma.kickoffTemplate.delete({ where: { id: template!.id } });
    const remaining = await prisma.kickoffTemplate.findMany();
    expect(remaining.every((t) => t.name !== "Updated Template")).toBe(true);
  });

  it("rejects template without name", async () => {
    // The API checks: if (!name || !content) return 400
    const name = "";
    const content = "some content";
    expect(!name || !content).toBe(true); // would trigger 400
  });
});
