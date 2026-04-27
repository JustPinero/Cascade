import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import fs from "fs";
import path from "path";
import os from "os";
import {
  scanForOrphans,
  recommend,
  applyRepair,
  type Orphan,
  type RepairAction,
} from "./migration-repair";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-migration-repair.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const TEST_PROJECTS_DIR = path.resolve(os.tmpdir(), "cascade-test-repair-projects");

let prisma: PrismaClient;

// Real directories for "alive" projects
const aliveDir1 = path.join(TEST_PROJECTS_DIR, "alive-one");
const aliveDir2 = path.join(TEST_PROJECTS_DIR, "alive-two");
const aliveDir3 = path.join(TEST_PROJECTS_DIR, "alive-three");
// Non-existent paths for "dead" (orphaned) projects
const deadPath1 = path.join(TEST_PROJECTS_DIR, "ghost-project-1");
const deadPath2 = path.join(TEST_PROJECTS_DIR, "ghost-project-2");


beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);

  // Create real directories for alive projects
  fs.mkdirSync(aliveDir1, { recursive: true });
  fs.mkdirSync(aliveDir2, { recursive: true });
  fs.mkdirSync(aliveDir3, { recursive: true });
  // NOTE: deadPath1 and deadPath2 are intentionally NOT created

  // Seed 3 alive + 2 dead projects
  await prisma.project.create({ data: { name: "Alive One", slug: "alive-one", path: aliveDir1, status: "building" } });
  await prisma.project.create({ data: { name: "Alive Two", slug: "alive-two", path: aliveDir2, status: "complete" } });
  await prisma.project.create({ data: { name: "Alive Three", slug: "alive-three", path: aliveDir3, status: "deployed" } });

  await prisma.project.create({ data: { name: "Ghost One", slug: "ghost-one", path: deadPath1, status: "building" } });
  await prisma.project.create({ data: { name: "Ghost Two", slug: "ghost-two", path: deadPath2, status: "archived" } });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
});

// ── scanForOrphans ──────────────────────────────────────────────────────────

describe("scanForOrphans", () => {
  it("returns only projects whose path does not exist on disk", async () => {
    const orphans = await scanForOrphans(prisma, { projectsDir: TEST_PROJECTS_DIR });
    expect(orphans).toHaveLength(2);
    const slugs = orphans.map((o) => o.slug).sort();
    expect(slugs).toEqual(["ghost-one", "ghost-two"]);
  });

  it("does not return alive projects", async () => {
    const orphans = await scanForOrphans(prisma, { projectsDir: TEST_PROJECTS_DIR });
    const slugs = orphans.map((o) => o.slug);
    expect(slugs).not.toContain("alive-one");
    expect(slugs).not.toContain("alive-two");
    expect(slugs).not.toContain("alive-three");
  });

  it("populates candidates.suggestedLocalPath as PROJECTS_DIR/<slug>", async () => {
    const orphans = await scanForOrphans(prisma, { projectsDir: TEST_PROJECTS_DIR });
    for (const orphan of orphans) {
      expect(orphan.candidates.suggestedLocalPath).toBe(
        path.join(TEST_PROJECTS_DIR, orphan.slug)
      );
    }
  });

  it("flags candidates.onDiskNow true when suggestedLocalPath already exists", async () => {
    // Create the suggested path for ghost-one so onDiskNow = true
    const suggestedForGhostOne = path.join(TEST_PROJECTS_DIR, "ghost-one");
    fs.mkdirSync(suggestedForGhostOne, { recursive: true });

    const orphans = await scanForOrphans(prisma, { projectsDir: TEST_PROJECTS_DIR });
    const ghostOne = orphans.find((o) => o.slug === "ghost-one");
    const ghostTwo = orphans.find((o) => o.slug === "ghost-two");

    expect(ghostOne?.candidates.onDiskNow).toBe(true);
    expect(ghostTwo?.candidates.onDiskNow).toBe(false);

    // Clean up
    fs.rmSync(suggestedForGhostOne, { recursive: true, force: true });
  });

  it("populates candidates.githubRemote from injected ghLookup", async () => {
    const mockLookup = vi.fn().mockReturnValue([
      { name: "ghost-one", sshUrl: "git@github.com:JustPinero/ghost-one.git" },
      { name: "other-repo", sshUrl: "git@github.com:JustPinero/other-repo.git" },
    ]);

    const orphans = await scanForOrphans(prisma, {
      projectsDir: TEST_PROJECTS_DIR,
      ghLookup: mockLookup,
    });

    const ghostOne = orphans.find((o) => o.slug === "ghost-one");
    const ghostTwo = orphans.find((o) => o.slug === "ghost-two");

    expect(ghostOne?.candidates.githubRemote).toBe("git@github.com:JustPinero/ghost-one.git");
    expect(ghostTwo?.candidates.githubRemote).toBeNull();
    expect(mockLookup).toHaveBeenCalled();
  });

  it("sets githubRemote to null when ghLookup returns null (gh not authenticated)", async () => {
    const mockLookup = vi.fn().mockReturnValue(null);

    const orphans = await scanForOrphans(prisma, {
      projectsDir: TEST_PROJECTS_DIR,
      ghLookup: mockLookup,
    });

    for (const orphan of orphans) {
      expect(orphan.candidates.githubRemote).toBeNull();
    }
  });
});

// ── recommend ───────────────────────────────────────────────────────────────

describe("recommend", () => {
  function makeOrphan(overrides: Partial<Orphan>): Orphan {
    return {
      id: 1,
      name: "Test",
      slug: "test",
      oldPath: "/old/path",
      status: "building",
      candidates: {
        githubRemote: null,
        suggestedLocalPath: "/projects/test",
        onDiskNow: false,
      },
      ...overrides,
    };
  }

  const cases: Array<[string, Partial<Orphan>, RepairAction]> = [
    [
      "clone when githubRemote exists + status building",
      { status: "building", candidates: { githubRemote: "git@github.com:x/y.git", suggestedLocalPath: "/p/y", onDiskNow: false } },
      "clone",
    ],
    [
      "clone when githubRemote exists + status deployed",
      { status: "deployed", candidates: { githubRemote: "git@github.com:x/y.git", suggestedLocalPath: "/p/y", onDiskNow: false } },
      "clone",
    ],
    [
      "archive when no githubRemote + status complete",
      { status: "complete", candidates: { githubRemote: null, suggestedLocalPath: "/p/y", onDiskNow: false } },
      "archive",
    ],
    [
      "delete when no githubRemote + status archived",
      { status: "archived", candidates: { githubRemote: null, suggestedLocalPath: "/p/y", onDiskNow: false } },
      "delete",
    ],
    [
      "skip when no githubRemote + status building",
      { status: "building", candidates: { githubRemote: null, suggestedLocalPath: "/p/y", onDiskNow: false } },
      "skip",
    ],
    [
      "skip when no githubRemote + status paused",
      { status: "paused", candidates: { githubRemote: null, suggestedLocalPath: "/p/y", onDiskNow: false } },
      "skip",
    ],
    [
      "skip when no githubRemote + status backburner",
      { status: "backburner", candidates: { githubRemote: null, suggestedLocalPath: "/p/y", onDiskNow: false } },
      "skip",
    ],
  ];

  for (const [label, overrides, expected] of cases) {
    it(label, () => {
      const orphan = makeOrphan(overrides);
      expect(recommend(orphan)).toBe(expected);
    });
  }
});

// ── applyRepair ─────────────────────────────────────────────────────────────

describe("applyRepair", () => {
  let applyProjectsDir: string;
  let applyDbPath: string;
  let applyPrisma: PrismaClient;
  let cloneProjectId: number;
  let archiveProjectId: number;
  let deleteProjectId: number;
  let cascadeSelfId: number;

  beforeAll(async () => {
    applyProjectsDir = path.resolve(os.tmpdir(), "cascade-test-apply-repair");
    applyDbPath = path.resolve(__dirname, "../prisma/test-apply-repair.db");
    const dbUrl = `file:${applyDbPath}`;

    try { fs.unlinkSync(applyDbPath); } catch {}
    fs.rmSync(applyProjectsDir, { recursive: true, force: true });
    fs.mkdirSync(applyProjectsDir, { recursive: true });

    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    applyPrisma = new PrismaClient({ adapter });
    pushTestSchema(dbUrl);

    const cloneProject = await applyPrisma.project.create({
      data: { name: "Clone Me", slug: "clone-me", path: "/old/clone-me", status: "building" },
    });
    cloneProjectId = cloneProject.id;

    const archiveProject = await applyPrisma.project.create({
      data: { name: "Archive Me", slug: "archive-me", path: "/old/archive-me", status: "complete", currentRequest: "3.1" },
    });
    archiveProjectId = archiveProject.id;

    const deleteProject = await applyPrisma.project.create({
      data: { name: "Delete Me", slug: "delete-me", path: "/old/delete-me", status: "archived" },
    });
    deleteProjectId = deleteProject.id;

    const cascadeProject = await applyPrisma.project.create({
      data: { name: "Cascade", slug: "cascade", path: "/old/cascade", status: "building" },
    });
    cascadeSelfId = cascadeProject.id;
  });

  afterAll(async () => {
    await applyPrisma.$disconnect();
    try { fs.unlinkSync(applyDbPath); } catch {}
    fs.rmSync(applyProjectsDir, { recursive: true, force: true });
  });

  it("clone: creates target dir and updates Project.path in DB", async () => {
    const targetDir = path.join(applyProjectsDir, "clone-me");
    // Simulate git clone by pre-creating the directory (avoid real network call in tests)
    const execSpy = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes("git clone")) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    });

    const result = await applyRepair(applyPrisma, cloneProjectId, "clone", {
      projectsDir: applyProjectsDir,
      execFn: execSpy,
      remote: "git@github.com:TestOrg/clone-me.git",
    });

    expect(result.action).toBe("clone");
    expect(execSpy).toHaveBeenCalledWith(expect.stringContaining("git clone"), expect.anything());

    const updated = await applyPrisma.project.findUnique({ where: { id: cloneProjectId } });
    expect(updated?.path).toBe(targetDir);
  });

  it("clone: dry-run does not call execFn or update DB", async () => {
    const execSpy = vi.fn();
    // Reset path to a known value first so we can assert it didn't change
    await applyPrisma.project.update({ where: { id: cloneProjectId }, data: { path: "/old/clone-me-reset" } });

    const result = await applyRepair(applyPrisma, cloneProjectId, "clone", {
      projectsDir: applyProjectsDir,
      execFn: execSpy,
      remote: "git@github.com:TestOrg/clone-me.git",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(execSpy).not.toHaveBeenCalled();
    const row = await applyPrisma.project.findUnique({ where: { id: cloneProjectId } });
    expect(row?.path).toBe("/old/clone-me-reset");
  });

  it("archive: sets status to archived and clears currentRequest", async () => {
    const result = await applyRepair(applyPrisma, archiveProjectId, "archive", {
      projectsDir: applyProjectsDir,
    });

    expect(result.action).toBe("archive");
    const updated = await applyPrisma.project.findUnique({ where: { id: archiveProjectId } });
    expect(updated?.status).toBe("archived");
    expect(updated?.currentRequest).toBeNull();
  });

  it("delete: removes the project row from the DB", async () => {
    const result = await applyRepair(applyPrisma, deleteProjectId, "delete", {
      projectsDir: applyProjectsDir,
    });

    expect(result.action).toBe("delete");
    const row = await applyPrisma.project.findUnique({ where: { id: deleteProjectId } });
    expect(row).toBeNull();
  });

  it("self-protection: refuses to delete the running Cascade instance", async () => {
    await expect(
      applyRepair(applyPrisma, cascadeSelfId, "delete", {
        projectsDir: applyProjectsDir,
        cascadeSelfSlug: "cascade",
      })
    ).rejects.toThrow(/cannot delete.*cascade/i);
  });

  it("path guard: refuses to clone into a path outside PROJECTS_DIR", async () => {
    // Add a project whose slug would resolve to a traversal path
    const outsideProject = await applyPrisma.project.create({
      data: { name: "Outside", slug: "../../../outside", path: "/nonexistent/outside", status: "building" },
    });

    await expect(
      applyRepair(applyPrisma, outsideProject.id, "clone", {
        projectsDir: applyProjectsDir,
      })
    ).rejects.toThrow(/outside.*projects.*dir|invalid.*path/i);

    await applyPrisma.project.delete({ where: { id: outsideProject.id } });
  });

  it("idempotency: running archive twice produces no further changes", async () => {
    const idempProject = await applyPrisma.project.create({
      data: { name: "Idem Test", slug: "idem-test", path: "/old/idem-test", status: "complete" },
    });

    await applyRepair(applyPrisma, idempProject.id, "archive", { projectsDir: applyProjectsDir });
    const afterFirst = await applyPrisma.project.findUnique({ where: { id: idempProject.id } });

    await applyRepair(applyPrisma, idempProject.id, "archive", { projectsDir: applyProjectsDir });
    const afterSecond = await applyPrisma.project.findUnique({ where: { id: idempProject.id } });

    expect(afterFirst?.status).toBe("archived");
    expect(afterSecond?.status).toBe("archived");
    expect(afterFirst?.updatedAt.getTime()).toBeLessThanOrEqual(afterSecond!.updatedAt.getTime());
  });
});
