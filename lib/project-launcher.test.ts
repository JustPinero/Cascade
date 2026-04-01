import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { launchProject } from "./project-launcher";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-launcher.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_DIR = path.resolve(__dirname, "../.test-launcher");

let prisma: PrismaClient;

beforeAll(() => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("launchProject", () => {
  it("creates project directory with kickoff file", async () => {
    const result = await launchProject(prisma, TEST_DIR, {
      name: "Test Launch",
      slug: "test-launch",
      projectType: "web-app",
      kickoffContent: "# Test Project\n\nKickoff content here.",
      createGithubRepo: false,
      isPrivate: true,
      autonomyMode: "semi",
      agentTeamsEnabled: false,
      prWorkflowEnabled: false,
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(result.projectPath)).toBe(true);
    expect(
      fs.existsSync(path.join(result.projectPath, "KICKOFF.md"))
    ).toBe(true);
  });

  it("initializes git in the project", () => {
    const projectPath = path.join(TEST_DIR, "Test Launch");
    expect(fs.existsSync(path.join(projectPath, ".git"))).toBe(true);
  });

  it("writes kickoff content correctly", () => {
    const projectPath = path.join(TEST_DIR, "Test Launch");
    const content = fs.readFileSync(
      path.join(projectPath, "KICKOFF.md"),
      "utf-8"
    );
    expect(content).toContain("# Test Project");
  });

  it("registers project in database", async () => {
    const project = await prisma.project.findUnique({
      where: { slug: "test-launch" },
    });
    expect(project).not.toBeNull();
    expect(project!.name).toBe("Test Launch");
    expect(project!.autonomyMode).toBe("semi");
  });

  it("creates activity event", async () => {
    const events = await prisma.activityEvent.findMany({
      where: { eventType: "project-created" },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].summary).toContain("Test Launch");
  });

  it("does not create GitHub repo when disabled", async () => {
    const project = await prisma.project.findUnique({
      where: { slug: "test-launch" },
    });
    expect(project!.githubRepo).toBeNull();
  });
});
