/**
 * Phase 25.3 — query_knowledge_with_citations tool tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { knowledgeCitationsTool } from "./overseer-tools-knowledge-citations";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface SeedLesson {
  title: string;
  content: string;
  category: string;
  severity: string;
  tags: string[];
}

async function seed(r: DispatchRig, lessons: SeedLesson[]): Promise<number[]> {
  const ids: number[] = [];
  for (const l of lessons) {
    const created = await r.prisma.knowledgeLesson.create({
      data: {
        title: l.title,
        content: l.content,
        category: l.category,
        severity: l.severity,
        tags: JSON.stringify(l.tags),
      },
    });
    ids.push(created.id);
  }
  return ids;
}

async function call(
  r: DispatchRig,
  input: Parameters<typeof knowledgeCitationsTool.handler>[0]
) {
  return knowledgeCitationsTool.handler(input, { prisma: r.prisma });
}

describe("query_knowledge_with_citations", () => {
  it("returns empty when the corpus has no matches", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      {
        title: "Tailwind dark mode",
        content: "Use the class strategy.",
        category: "performance",
        severity: "nice-to-know",
        tags: ["tailwind"],
      },
    ]);
    const result = await call(rig, { query: "rocket fuel preparation" });
    expect(result.totalMatches).toBe(0);
    expect(result.lessons).toEqual([]);
    expect(result.briefing).toMatch(/no matching lessons/i);
  });

  it("returns top-N lessons in score order with [L-<id>] markers in briefing", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const ids = await seed(rig, [
      {
        title: "SQLite concurrent writes need WAL mode",
        content: "Switch to WAL journaling when SQLITE_BUSY surfaces.",
        category: "database",
        severity: "critical",
        tags: ["sqlite", "wal", "concurrency"],
      },
      {
        title: "Tailwind dark mode",
        content: "Use the class strategy.",
        category: "performance",
        severity: "nice-to-know",
        tags: ["tailwind"],
      },
    ]);
    const result = await call(rig, {
      query: "SQLITE_BUSY errors under concurrent writes",
    });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.lessons[0].id).toBe(ids[0]); // SQLite lesson ranks first
    expect(result.briefing).toContain(`[L-${ids[0]}]`);
    expect(result.briefing).toContain("WAL");
  });

  it("respects topN cap (max 10)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const seedRows: SeedLesson[] = [];
    for (let i = 0; i < 20; i++) {
      seedRows.push({
        title: `Database lesson ${i}`,
        content: "database content with database keyword",
        category: "database",
        severity: "nice-to-know",
        tags: ["database"],
      });
    }
    await seed(rig, seedRows);
    const result = await call(rig, {
      query: "database performance tuning",
      topN: 50,
    });
    expect(result.lessons.length).toBeLessThanOrEqual(10);
    expect(result.topN).toBe(10);
  });

  it("truncates very long lesson content in the briefing", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const longContent = "deployment ".repeat(500);
    await seed(rig, [
      {
        title: "Long deployment lesson",
        content: longContent,
        category: "deployment",
        severity: "important",
        tags: ["deployment"],
      },
    ]);
    const result = await call(rig, { query: "deployment trouble" });
    // Truncated to ~1200 chars + ellipsis
    const lessonChunk = result.briefing.split("\n\n---\n\n")[0];
    expect(lessonChunk.length).toBeLessThan(1500);
    expect(lessonChunk).toMatch(/…$/);
  });

  it("matchedKeywords are returned per lesson", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      {
        title: "Auth tokens belong in httpOnly cookies",
        content: "Storing session tokens in localStorage exposes them to XSS.",
        category: "auth",
        severity: "critical",
        tags: ["auth", "tokens", "session"],
      },
    ]);
    const result = await call(rig, { query: "session tokens in localStorage" });
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0].matchedKeywords.length).toBeGreaterThan(0);
  });
});
