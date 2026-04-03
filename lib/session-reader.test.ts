import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { getSessionLogs } from "./session-reader";

const TEST_DIR = path.resolve(__dirname, "../.test-session-reader");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function createProjectWithSessions(
  name: string,
  sessions: Array<{ filename: string; content: string }>
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const sessionsDir = path.join(dir, ".claude", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  for (const s of sessions) {
    await fs.writeFile(path.join(sessionsDir, s.filename), s.content);
  }

  return dir;
}

describe("getSessionLogs", () => {
  it("reads session logs sorted newest-first", async () => {
    const dir = await createProjectWithSessions("multi-session", [
      {
        filename: "2026-04-01T10-00-00.md",
        content: "# Session 1\nFirst session work.",
      },
      {
        filename: "2026-04-02T14-30-00.md",
        content: "# Session 2\nSecond session work.",
      },
      {
        filename: "2026-04-03T09-15-00.md",
        content: "# Session 3\nThird session work.",
      },
    ]);

    const logs = await getSessionLogs(dir);

    expect(logs).toHaveLength(3);
    // Newest first
    expect(logs[0].filename).toBe("2026-04-03T09-15-00.md");
    expect(logs[1].filename).toBe("2026-04-02T14-30-00.md");
    expect(logs[2].filename).toBe("2026-04-01T10-00-00.md");
  });

  it("extracts timestamp from filename", async () => {
    const dir = await createProjectWithSessions("timestamp", [
      {
        filename: "2026-04-03T09-15-00.md",
        content: "# Session\nContent here.",
      },
    ]);

    const logs = await getSessionLogs(dir);
    expect(logs[0].timestamp).toBe("2026-04-03T09:15:00");
  });

  it("returns content and truncated summary", async () => {
    const longContent = "# Session Handoff\n\n" + "A".repeat(600);
    const dir = await createProjectWithSessions("content-test", [
      { filename: "2026-04-03T09-15-00.md", content: longContent },
    ]);

    const logs = await getSessionLogs(dir);
    expect(logs[0].content).toBe(longContent);
    expect(logs[0].summary.length).toBeLessThanOrEqual(500);
  });

  it("respects limit parameter", async () => {
    const dir = await createProjectWithSessions("limit-test", [
      { filename: "2026-04-01T10-00-00.md", content: "Session 1" },
      { filename: "2026-04-02T10-00-00.md", content: "Session 2" },
      { filename: "2026-04-03T10-00-00.md", content: "Session 3" },
    ]);

    const logs = await getSessionLogs(dir, 2);
    expect(logs).toHaveLength(2);
    // Should be the 2 newest
    expect(logs[0].filename).toBe("2026-04-03T10-00-00.md");
    expect(logs[1].filename).toBe("2026-04-02T10-00-00.md");
  });

  it("returns empty array when sessions directory is missing", async () => {
    const dir = path.join(TEST_DIR, "no-sessions");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const logs = await getSessionLogs(dir);
    expect(logs).toEqual([]);
  });

  it("returns empty array for nonexistent project", async () => {
    const logs = await getSessionLogs("/nonexistent/project");
    expect(logs).toEqual([]);
  });

  it("ignores non-md files in sessions directory", async () => {
    const dir = await createProjectWithSessions("mixed-files", [
      { filename: "2026-04-03T09-15-00.md", content: "Session" },
    ]);
    // Add a non-md file
    await fs.writeFile(
      path.join(dir, ".claude", "sessions", ".DS_Store"),
      "junk"
    );

    const logs = await getSessionLogs(dir);
    expect(logs).toHaveLength(1);
  });
});
