import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import * as childProcess from "child_process";
import { syncLessonToBrain, slugify, type BrainLesson } from "./brain-sync";

let scratchRoot: string;

function makeLesson(overrides: Partial<BrainLesson> = {}): BrainLesson {
  return {
    title: "Always use WAL mode",
    content:
      "When using SQLite with Prisma, enable WAL mode for better concurrent reads.",
    sourceProject: "test-project",
    date: "2026-07-07",
    tags: ["database", "sqlite"],
    ...overrides,
  };
}

beforeEach(async () => {
  scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-sync-"));
});

afterEach(async () => {
  await fs.rm(scratchRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("slugify", () => {
  it("produces kebab-case from a plain title", () => {
    expect(slugify("Always use WAL mode")).toBe("always-use-wal-mode");
  });

  it("strips punctuation and emoji into a filesystem-safe slug", () => {
    const slug = slugify("Don't trust client data! 🚨 (validate) — API/routes");
    // No spaces, no punctuation, no emoji, no slashes — kebab only
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug).not.toContain(" ");
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("!");
  });

  it("never yields an empty slug", () => {
    expect(slugify("🚨🚨🚨").length).toBeGreaterThan(0);
    expect(slugify("").length).toBeGreaterThan(0);
  });
});

describe("syncLessonToBrain", () => {
  it("writes a markdown file with frontmatter and body", async () => {
    const res = await syncLessonToBrain(makeLesson(), { brainPath: scratchRoot });

    expect(res.written).toBe(true);
    expect(res.filePath).not.toBeNull();

    const filePath = path.join(
      scratchRoot,
      "playbook",
      "lessons",
      "always-use-wal-mode.md"
    );
    const content = await fs.readFile(filePath, "utf-8");

    // Frontmatter present
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("source: test-project");
    expect(content).toContain("date: 2026-07-07");
    expect(content).toContain("database");
    expect(content).toContain("sqlite");
    // Body present
    expect(content).toContain(
      "When using SQLite with Prisma, enable WAL mode"
    );
  });

  it("writes a filesystem-safe filename for titles with punctuation/emoji", async () => {
    const lesson = makeLesson({
      title: "Don't trust client data! 🚨 (validate) — API/routes",
    });
    const res = await syncLessonToBrain(lesson, { brainPath: scratchRoot });

    expect(res.written).toBe(true);
    const lessonsDir = path.join(scratchRoot, "playbook", "lessons");
    const files = await fs.readdir(lessonsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
  });

  it("updates the same file on re-harvest instead of duplicating", async () => {
    await syncLessonToBrain(makeLesson({ content: "first version" }), {
      brainPath: scratchRoot,
    });
    await syncLessonToBrain(makeLesson({ content: "second version" }), {
      brainPath: scratchRoot,
    });

    const lessonsDir = path.join(scratchRoot, "playbook", "lessons");
    const files = await fs.readdir(lessonsDir);
    expect(files.length).toBe(1);

    const content = await fs.readFile(
      path.join(lessonsDir, files[0]),
      "utf-8"
    );
    expect(content).toContain("second version");
    expect(content).not.toContain("first version");
  });

  it("skips gracefully when the brain dir is missing, logging once and not throwing", async () => {
    const missing = path.join(scratchRoot, "does", "not", "exist");
    const logs: string[] = [];

    const res = await syncLessonToBrain(makeLesson(), {
      brainPath: missing,
      logger: (m) => logs.push(m),
    });

    expect(res.written).toBe(false);
    expect(res.reason).toBe("missing-brain");
    // No file created anywhere under the missing path
    await expect(fs.access(missing)).rejects.toBeTruthy();
    // Exactly one log line
    expect(logs.length).toBe(1);
    expect(logs[0].toLowerCase()).toContain("brain");
  });

  it("performs no git / shell operations (spy on the exec boundary)", async () => {
    const execSyncSpy = vi.spyOn(childProcess, "execSync");
    const execSpy = vi.spyOn(childProcess, "exec");
    const execFileSpy = vi.spyOn(childProcess, "execFile");
    const spawnSpy = vi.spyOn(childProcess, "spawn");

    await syncLessonToBrain(makeLesson(), { brainPath: scratchRoot });

    expect(execSyncSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
