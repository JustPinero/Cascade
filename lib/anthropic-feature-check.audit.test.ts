import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import {
  auditProjectFeatureUsage,
  auditAllProjects,
  syncSeedCatalog,
} from "@/lib/anthropic-feature-check";
import type { DetectorInput } from "@/lib/anthropic-feature-detectors";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-audit.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;
let projectAId: number;
let projectBId: number;
let projectAPath: string;
let projectBPath: string;
let tmpRoot: string;

function inputFor(over: Partial<DetectorInput>): DetectorInput {
  return {
    projectPath: "/tmp/x",
    claudeMd: "",
    settingsJson: null,
    packageJson: null,
    hasCommandsDir: false,
    hasSkillsDir: false,
    hasIDEDir: false,
    codeContents: "",
    ...over,
  };
}

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);

  // Seed the catalog from the real file.
  await syncSeedCatalog(prisma, path.resolve(__dirname, ".."));

  // Two test projects on disk — A has lots of features, B has few.
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "cascade-audit-"));

  projectAPath = path.join(tmpRoot, "project-a");
  await fsp.mkdir(path.join(projectAPath, ".claude", "commands"), { recursive: true });
  await fsp.mkdir(path.join(projectAPath, "lib"), { recursive: true });
  await fsp.writeFile(
    path.join(projectAPath, "CLAUDE.md"),
    "# Project A\nUses agent teams and Plan Mode.",
  );
  await fsp.writeFile(
    path.join(projectAPath, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [{ matcher: "", hooks: [] }],
        PostCompact: [{ matcher: "", hooks: [] }],
      },
      statusLine: "echo X",
    }),
  );
  await fsp.writeFile(
    path.join(projectAPath, "lib", "code.ts"),
    'cache_control: { type: "ephemeral" }',
  );

  projectBPath = path.join(tmpRoot, "project-b");
  await fsp.mkdir(projectBPath, { recursive: true });
  await fsp.writeFile(path.join(projectBPath, "CLAUDE.md"), "# Project B (sparse)");

  const a = await prisma.project.create({
    data: {
      name: "project-a",
      slug: "project-a",
      path: projectAPath,
    },
  });
  projectAId = a.id;
  const b = await prisma.project.create({
    data: {
      name: "project-b",
      slug: "project-b",
      path: projectBPath,
    },
  });
  projectBId = b.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe("auditProjectFeatureUsage", () => {
  it("detects multiple features for a feature-rich project", async () => {
    const result = await auditProjectFeatureUsage(prisma, projectAId);
    expect(result.detected.length).toBeGreaterThan(3);
    const names = result.detected.map((d) => d.featureName);
    expect(names).toContain("Stop Hook");
    expect(names).toContain("PostCompact Hook");
    expect(names).toContain("Status Line");
    // Some seed entries have parenthesized descriptors in the heading
    // (e.g. "Slash Commands (`.claude/commands/`)") — match on prefix.
    expect(names.some((n) => n.startsWith("Slash Commands"))).toBe(true);
  });

  it("detects few features for a sparse project", async () => {
    const result = await auditProjectFeatureUsage(prisma, projectBId);
    expect(result.detected.length).toBeLessThan(3);
  });

  it("is idempotent — second run produces same row count", async () => {
    const before = await prisma.projectFeatureUsage.count({
      where: { projectId: projectAId },
    });
    await auditProjectFeatureUsage(prisma, projectAId);
    const after = await prisma.projectFeatureUsage.count({
      where: { projectId: projectAId },
    });
    expect(after).toBe(before);
  });

  it("removes stale rows when a feature is no longer detected", async () => {
    // Use the inputOverride path to pretend project A no longer has Stop hook.
    const override = inputFor({
      projectPath: projectAPath,
      claudeMd: "# Project A\nUses agent teams.",
      settingsJson: { hooks: {} }, // no Stop, no PostCompact
      hasCommandsDir: false,
      codeContents: "",
    });
    const result = await auditProjectFeatureUsage(prisma, projectAId, override);
    expect(result.removed).toBeGreaterThan(0);

    const remaining = await prisma.projectFeatureUsage.findMany({
      where: { projectId: projectAId },
      include: { feature: true },
    });
    expect(remaining.find((r) => r.feature.name === "Stop Hook")).toBeUndefined();
  });
});

describe("auditAllProjects", () => {
  it("audits every project in the DB without throwing", async () => {
    const result = await auditAllProjects(prisma);
    expect(result.totalProjects).toBe(2);
    expect(result.perProject.length).toBe(2);
  });

  it("continues past a single project failure (best-effort)", async () => {
    // Add a project with a non-existent path so its audit will error
    // when loadDetectorInput tries to read.
    await prisma.project.create({
      data: { name: "ghost", slug: "ghost-project", path: "/no/such/path" },
    });
    const result = await auditAllProjects(prisma);
    expect(result.totalProjects).toBe(3);
    // The ghost may or may not show up depending on how loadDetectorInput
    // handles missing paths; the non-throw guarantee is the test.
  });
});
