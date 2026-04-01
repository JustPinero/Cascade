import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { generateManifest } from "./manifest-generator";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-manifest.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_MANIFEST = path.resolve(__dirname, "../.test-manifest/manifest.md");

let prisma: PrismaClient;

beforeAll(async () => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  // Create test data
  const project = await prisma.project.create({
    data: { name: "Test", slug: "test", path: "/tmp/test" },
  });

  await prisma.knowledgeLesson.createMany({
    data: [
      {
        title: "Use WAL mode",
        content: "Enable WAL for SQLite",
        category: "database",
        severity: "critical",
        tags: "[]",
        sourceProjectId: project.id,
      },
      {
        title: "Lazy load images",
        content: "Use next/image with lazy loading",
        category: "performance",
        severity: "nice-to-know",
        tags: "[]",
        sourceProjectId: project.id,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.rmSync(path.dirname(TEST_MANIFEST), { recursive: true, force: true });
  } catch {}
});

describe("generateManifest", () => {
  it("generates a manifest file", async () => {
    const result = await generateManifest(prisma, TEST_MANIFEST);
    expect(result.lessonCount).toBe(2);
    expect(result.categoryCount).toBe(2);
    expect(fs.existsSync(TEST_MANIFEST)).toBe(true);
  });

  it("manifest contains category headers", () => {
    const content = fs.readFileSync(TEST_MANIFEST, "utf-8");
    expect(content).toContain("## database");
    expect(content).toContain("## performance");
  });

  it("manifest contains lesson titles", () => {
    const content = fs.readFileSync(TEST_MANIFEST, "utf-8");
    expect(content).toContain("Use WAL mode");
    expect(content).toContain("Lazy load images");
  });

  it("manifest includes severity markers for critical", () => {
    const content = fs.readFileSync(TEST_MANIFEST, "utf-8");
    expect(content).toContain("[!!!]");
  });

  it("manifest includes timestamp and count", () => {
    const content = fs.readFileSync(TEST_MANIFEST, "utf-8");
    expect(content).toContain("Total lessons: 2");
    expect(content).toContain("Generated:");
  });

  it("regeneration overwrites correctly", async () => {
    const result = await generateManifest(prisma, TEST_MANIFEST);
    expect(result.lessonCount).toBe(2);
    const content = fs.readFileSync(TEST_MANIFEST, "utf-8");
    expect(content).toContain("Knowledge Base Manifest");
  });
});
