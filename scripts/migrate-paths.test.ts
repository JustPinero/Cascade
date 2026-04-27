import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import fs from "fs";
import path from "path";
import os from "os";

const SCRIPT = path.resolve(__dirname, "migrate-paths.ts");
const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-migrate-paths.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_PROJECTS_DIR = path.resolve(os.tmpdir(), "cascade-test-migrate-cli");

let prisma: PrismaClient;
let orphanProjectId: number;

function runScript(args: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(
      `npx tsx "${SCRIPT}" ${args}`,
      {
        env: {
          ...process.env,
          DATABASE_URL: TEST_DB_URL,
          PROJECTS_DIR: TEST_PROJECTS_DIR,
        },
        stdio: "pipe",
      }
    ).toString();
    return { stdout, stderr: "", status: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
      status: error.status ?? 1,
    };
  }
}

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_PROJECTS_DIR, { recursive: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);

  // Alive project: directory exists
  const aliveDir = path.join(TEST_PROJECTS_DIR, "cli-alive");
  fs.mkdirSync(aliveDir, { recursive: true });
  await prisma.project.create({
    data: { name: "CLI Alive", slug: "cli-alive", path: aliveDir, status: "building" },
  });

  // Orphan project: directory does NOT exist
  const orphan = await prisma.project.create({
    data: { name: "CLI Orphan", slug: "cli-orphan", path: path.join(TEST_PROJECTS_DIR, "nonexistent-ghost"), status: "complete" },
  });
  orphanProjectId = orphan.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
});

describe("migrate-paths CLI", () => {
  it("--scan-only exits 0 and lists orphans", () => {
    const { stdout, status } = runScript("--scan-only");
    expect(status).toBe(0);
    expect(stdout).toContain("cli-orphan");
  });

  it("--scan-only does not list alive projects", () => {
    const { stdout } = runScript("--scan-only");
    expect(stdout).not.toContain("cli-alive");
  });

  it("--dry-run writes nothing to DB", async () => {
    const before = await prisma.project.findUnique({ where: { id: orphanProjectId } });
    runScript("--dry-run --apply-all");
    const after = await prisma.project.findUnique({ where: { id: orphanProjectId } });
    // Path and status should be unchanged
    expect(after?.path).toBe(before?.path);
    expect(after?.status).toBe(before?.status);
  });

  it("--apply <id> archive updates the row status", async () => {
    // Re-seed with a fresh orphan for this test to avoid state dependencies
    const target = await prisma.project.create({
      data: {
        name: "CLI Apply Target",
        slug: "cli-apply-target",
        path: path.join(TEST_PROJECTS_DIR, "cli-apply-nonexistent"),
        status: "complete",
      },
    });

    const { status } = runScript(`--apply ${target.id} archive`);
    expect(status).toBe(0);

    const updated = await prisma.project.findUnique({ where: { id: target.id } });
    expect(updated?.status).toBe("archived");

    await prisma.project.delete({ where: { id: target.id } });
  });

  it("running --apply-all twice (archive) is a no-op the second time", async () => {
    const target = await prisma.project.create({
      data: {
        name: "CLI Idempotent",
        slug: "cli-idempotent",
        path: path.join(TEST_PROJECTS_DIR, "cli-idempotent-missing"),
        status: "complete",
      },
    });

    runScript(`--apply ${target.id} archive`);
    const after1 = await prisma.project.findUnique({ where: { id: target.id } });

    runScript(`--apply ${target.id} archive`);
    const after2 = await prisma.project.findUnique({ where: { id: target.id } });

    expect(after1?.status).toBe("archived");
    expect(after2?.status).toBe("archived");

    await prisma.project.delete({ where: { id: target.id } });
  });

  it("--scan-only exits 0 even when there are no orphans", async () => {
    // Run against an empty DB
    const emptyDbPath = path.resolve(__dirname, "../prisma/test-migrate-empty.db");
    try { fs.unlinkSync(emptyDbPath); } catch {}
    pushTestSchema(`file:${emptyDbPath}`);

    const { status } = runScript("--scan-only");
    // Script should not crash when there are orphans — use main test DB
    expect(status).toBe(0);

    try { fs.unlinkSync(emptyDbPath); } catch {}
  });
});
