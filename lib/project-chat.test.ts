import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { buildProjectSystemPrompt } from "./project-chat";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-chat.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../.test-chat");

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."), stdio: "pipe",
  });

  // Create project directory with context files
  fs.mkdirSync(path.join(TEST_DIR, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, "audits"), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, "CLAUDE.md"), "# Test Project\nUse TypeScript strict.");
  fs.writeFileSync(path.join(TEST_DIR, ".claude", "handoff.md"), "Last session: fixed auth bug.");
  fs.writeFileSync(path.join(TEST_DIR, "audits", "debt.md"), "## Open\n- Fix login timeout\n## Resolved\n");

  await prisma.knowledgeLesson.create({
    data: { title: "Always validate inputs", content: "Validate all API inputs", category: "testing", severity: "critical", tags: "[]" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildProjectSystemPrompt", () => {
  it("includes project CLAUDE.md content", async () => {
    const prompt = await buildProjectSystemPrompt(prisma, TEST_DIR, "Test Project");
    expect(prompt).toContain("TypeScript strict");
  });

  it("includes handoff content", async () => {
    const prompt = await buildProjectSystemPrompt(prisma, TEST_DIR, "Test Project");
    expect(prompt).toContain("fixed auth bug");
  });

  it("includes debt log", async () => {
    const prompt = await buildProjectSystemPrompt(prisma, TEST_DIR, "Test Project");
    expect(prompt).toContain("Fix login timeout");
  });

  it("includes knowledge lessons", async () => {
    const prompt = await buildProjectSystemPrompt(prisma, TEST_DIR, "Test Project");
    expect(prompt).toContain("Always validate inputs");
  });

  it("includes project name", async () => {
    const prompt = await buildProjectSystemPrompt(prisma, TEST_DIR, "Test Project");
    expect(prompt).toContain("Test Project");
  });

  it("handles missing files gracefully", async () => {
    const emptyDir = path.join(TEST_DIR, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    const prompt = await buildProjectSystemPrompt(prisma, emptyDir, "Empty");
    expect(prompt).toContain("No CLAUDE.md found");
  });
});
