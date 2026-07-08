/**
 * Phase 41.4 — fleet reconciliation acceptance tests.
 *
 * Covers seven of the eight acceptance-criteria rows from
 * requests/phase-41-trustworthy-fleet/41.4-fleet-reconciliation.md
 * (the eighth — briefing surfacing — lives in app/api/briefing/route.test.ts).
 *
 * All fixtures are scratch git repos under .test-reconcile/, including a
 * local bare repo acting as "origin" for ahead/behind and unpushed-branch
 * checks. The live fleet and dev.db are never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import {
  reconcileProject,
  reconcileFleet,
  formatDriftSection,
  type ProjectReconciliation,
  type ReconciliationFindingType,
} from "./fleet-reconciler";

const TEST_DIR = path.resolve(__dirname, "../.test-reconcile");

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Cascade", "-c", "user.email=test@local.dev", ...args],
    { cwd, stdio: "pipe" }
  )
    .toString()
    .trim();
}

async function makeRepo(name: string): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  await fs.writeFile(path.join(dir, "README.md"), `# ${name}\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  return dir;
}

async function makeBare(name: string): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, "init", "--bare", "-b", "main");
  return dir;
}

async function commitFile(
  dir: string,
  file: string,
  content: string,
  message: string
): Promise<void> {
  await fs.writeFile(path.join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message);
}

function findingTypes(rec: ProjectReconciliation): ReconciliationFindingType[] {
  return rec.findings.map((f) => f.type);
}

function findingOf<T extends ReconciliationFindingType>(
  rec: ProjectReconciliation,
  type: T
): Extract<ProjectReconciliation["findings"][number], { type: T }> | undefined {
  return rec.findings.find(
    (f): f is Extract<ProjectReconciliation["findings"][number], { type: T }> =>
      f.type === type
  );
}

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("reconcileProject — path checks", () => {
  it("flags a missing project path as path-missing", async () => {
    const deadPath = path.join(TEST_DIR, "does-not-exist-anywhere");
    const rec = await reconcileProject({
      slug: "ghost",
      name: "Ghost",
      path: deadPath,
      status: "building",
    });

    expect(findingTypes(rec)).toContain("path-missing");
    const finding = findingOf(rec, "path-missing");
    expect(finding?.dbPath).toBe(deadPath);
    expect(finding?.severity).toBe("critical");
    expect(rec.resolvedPath).toBeNull();
    // Remote checks are impossible without a path — skipped with a reason.
    expect(rec.remote.checked).toBe(false);
    expect(rec.remote.reason).toBeTruthy();
  });

  it("normalizes path casing: no false path-missing, but a path-casing notice", async () => {
    const actual = await makeRepo("cased-project");
    // DB stored the path with different casing (Desktop/Projects vs projects).
    const misCased = path.join(TEST_DIR, "Cased-Project");

    const rec = await reconcileProject({
      slug: "cased",
      name: "Cased",
      path: misCased,
      status: "building",
    });

    expect(findingTypes(rec)).not.toContain("path-missing");
    expect(findingTypes(rec)).toContain("path-casing");
    const finding = findingOf(rec, "path-casing");
    expect(finding?.dbPath).toBe(misCased);
    expect(finding?.diskPath).toBe(actual);
    expect(finding?.severity).toBe("notice");
    // Subsequent checks run against the real on-disk path.
    expect(rec.resolvedPath).toBe(actual);
  });

  it("does not emit path-casing when the DB path matches disk exactly", async () => {
    const actual = await makeRepo("exact-cased");
    const rec = await reconcileProject({
      slug: "exact",
      name: "Exact",
      path: actual,
      status: "building",
    });
    expect(findingTypes(rec)).not.toContain("path-casing");
    expect(findingTypes(rec)).not.toContain("path-missing");
    expect(rec.resolvedPath).toBe(actual);
  });
});

describe("reconcileProject — working tree", () => {
  it("reports the dirty-file count", async () => {
    const dir = await makeRepo("dirty-repo");
    await fs.writeFile(path.join(dir, "a.txt"), "one");
    await fs.writeFile(path.join(dir, "b.txt"), "two");
    await fs.writeFile(path.join(dir, "c.txt"), "three");

    const rec = await reconcileProject({
      slug: "dirty",
      name: "Dirty",
      path: dir,
      status: "building",
    });

    const finding = findingOf(rec, "dirty-tree");
    expect(finding).toBeDefined();
    expect(finding?.dirtyCount).toBe(3);
    expect(finding?.message).toContain("3");
  });

  it("emits no dirty-tree finding for a clean tree", async () => {
    const dir = await makeRepo("clean-repo");
    const rec = await reconcileProject({
      slug: "clean",
      name: "Clean",
      path: dir,
      status: "building",
    });
    expect(findingTypes(rec)).not.toContain("dirty-tree");
  });
});

describe("reconcileProject — remote comparison", () => {
  it("computes ahead and behind counts against origin", async () => {
    const bare = await makeBare("ab-origin.git");
    const dir = await makeRepo("ab-repo");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-u", "origin", "main");

    // Another machine pushes a commit we don't have.
    const other = path.join(TEST_DIR, "ab-other");
    git(TEST_DIR, "clone", bare, other);
    await commitFile(other, "remote-work.txt", "from other machine", "remote work");
    git(other, "push", "origin", "main");

    // Local work not yet pushed.
    await commitFile(dir, "local-work.txt", "local only", "local work");

    const rec = await reconcileProject({
      slug: "ab",
      name: "AB",
      path: dir,
      status: "building",
    });

    const finding = findingOf(rec, "ahead-behind");
    expect(finding).toBeDefined();
    expect(finding?.ahead).toBe(1);
    expect(finding?.behind).toBe(1);
    expect(finding?.branch).toBe("main");
    expect(rec.remote.checked).toBe(true);
    expect(rec.remote.fetched).toBe(true);
  });

  it("detects a local-only branch as unpushed", async () => {
    const bare = await makeBare("unpushed-origin.git");
    const dir = await makeRepo("unpushed-repo");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-u", "origin", "main");
    git(dir, "branch", "feature-x");

    const rec = await reconcileProject({
      slug: "unpushed",
      name: "Unpushed",
      path: dir,
      status: "building",
    });

    const finding = findingOf(rec, "unpushed-branch");
    expect(finding).toBeDefined();
    expect(finding?.branches).toContain("feature-x");
    expect(finding?.branches).not.toContain("main");
  });

  it("skips remote checks with a reason when no remote exists", async () => {
    const dir = await makeRepo("no-remote-repo");
    const rec = await reconcileProject({
      slug: "noremote",
      name: "NoRemote",
      path: dir,
      status: "building",
    });

    expect(rec.remote.checked).toBe(false);
    expect(rec.remote.fetched).toBe(false);
    expect(rec.remote.reason).toBeTruthy();
    expect(findingTypes(rec)).not.toContain("ahead-behind");
    expect(findingTypes(rec)).not.toContain("unpushed-branch");
  });

  it("tolerates an unreachable remote: fetch fails, no throw, reason recorded", async () => {
    const dir = await makeRepo("offline-repo");
    git(
      dir,
      "remote",
      "add",
      "origin",
      path.join(TEST_DIR, "no-such-bare-repo.git")
    );

    const rec = await reconcileProject({
      slug: "offline",
      name: "Offline",
      path: dir,
      status: "building",
    });

    expect(rec.remote.fetched).toBe(false);
    expect(rec.remote.reason).toBeTruthy();
    expect(rec.remote.reason).toMatch(/fetch/i);
  });
});

describe("reconcileProject — status drift", () => {
  it("flags status 'complete' with a dirty tree as status-drift", async () => {
    const dir = await makeRepo("drift-complete");
    await fs.writeFile(path.join(dir, "leftover.txt"), "uncommitted");

    const rec = await reconcileProject({
      slug: "drift",
      name: "Drift",
      path: dir,
      status: "complete",
    });

    const finding = findingOf(rec, "status-drift");
    expect(finding).toBeDefined();
    expect(finding?.status).toBe("complete");
    expect(finding?.evidence.length).toBeGreaterThan(0);
  });

  it("flags status 'complete' with unpushed work as status-drift", async () => {
    const bare = await makeBare("drift-origin.git");
    const dir = await makeRepo("drift-unpushed");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-u", "origin", "main");
    await commitFile(dir, "wip.txt", "not pushed", "unpushed work");

    const rec = await reconcileProject({
      slug: "drift2",
      name: "Drift2",
      path: dir,
      status: "complete",
    });

    expect(findingTypes(rec)).toContain("status-drift");
  });

  it("does not flag a clean, pushed, complete project", async () => {
    const bare = await makeBare("settled-origin.git");
    const dir = await makeRepo("settled-repo");
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-u", "origin", "main");

    const rec = await reconcileProject({
      slug: "settled",
      name: "Settled",
      path: dir,
      status: "complete",
    });

    expect(findingTypes(rec)).not.toContain("status-drift");
    expect(rec.findings).toHaveLength(0);
  });
});

describe("reconcileFleet + formatDriftSection", () => {
  it("aggregates findings across projects and exposes only drifted ones", async () => {
    const dirty = await makeRepo("fleet-dirty");
    await fs.writeFile(path.join(dirty, "x.txt"), "dirty");
    const clean = await makeRepo("fleet-clean");

    const fleet = await reconcileFleet([
      { slug: "fleet-dirty", name: "Fleet Dirty", path: dirty, status: "building" },
      { slug: "fleet-clean", name: "Fleet Clean", path: clean, status: "building" },
    ]);

    expect(fleet.findingsCount).toBeGreaterThanOrEqual(1);
    expect(fleet.projects).toHaveLength(2);
    expect(fleet.drifted.map((p) => p.slug)).toContain("fleet-dirty");
    expect(fleet.drifted.map((p) => p.slug)).not.toContain("fleet-clean");
  });

  it("formats a drift section naming the drifted projects", async () => {
    const dirty = await makeRepo("section-dirty");
    await fs.writeFile(path.join(dirty, "y.txt"), "dirty");

    const fleet = await reconcileFleet([
      { slug: "section-dirty", name: "Section Dirty", path: dirty, status: "building" },
    ]);

    const section = formatDriftSection(fleet);
    expect(section).toBeTruthy();
    expect(section).toContain("section-dirty");
  });

  it("returns null when there is no drift", async () => {
    const clean = await makeRepo("section-clean");
    const fleet = await reconcileFleet([
      { slug: "section-clean", name: "Section Clean", path: clean, status: "building" },
    ]);
    expect(formatDriftSection(fleet)).toBeNull();
  });
});
